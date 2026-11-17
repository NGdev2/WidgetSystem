"""HTTP core: serves the shell + widget files, a JSON API and a server-sent event stream.

Everything the web runtime needs goes through here, so the same shell runs inside the
desktop host window (GTK/WebKit) or in any normal browser for development.
"""
import hashlib
import json
import mimetypes
import os
import queue
import secrets
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import config, desktop
from .registry import Registry
from .sysinfo import SysInfo

MIME = {".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".svg": "image/svg+xml", ".wasm": "application/wasm", ".html": "text/html", ".webp": "image/webp"}


def _gsettings(schema, key):
    try:
        out = subprocess.run(["gsettings", "get", schema, key], capture_output=True, text=True, timeout=2)
        return out.stdout.strip().strip("'") if out.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        return None


class Bus:
    def __init__(self):
        self.clients = set()
        self.lock = threading.Lock()

    def subscribe(self):
        q = queue.Queue()
        with self.lock:
            self.clients.add(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)

    def emit(self, type_, data=None):
        with self.lock:
            for q in self.clients:
                q.put({"type": type_, "data": data})


class App:
    def __init__(self, port=None, debug=False):
        self.store = config.Store()
        self.port = port or self.store.config.get("port", config.DEFAULT_PORT)
        self.token = secrets.token_urlsafe(16)
        self.debug = debug
        self.bus = Bus()
        self.host = None            # set by the GTK host when present
        self.sys = SysInfo()
        self.log_lock = threading.Lock()
        self.registry = Registry(self.store, self.log)
        self.registry.scan()
        self.theme = self._read_theme()
        self.layout_cache = self.store.load_layout()

    # logging
    def log(self, msg):
        line = f"{time.strftime('%H:%M:%S')} {msg}"
        print(line, flush=True)
        with self.log_lock:
            try:
                with open(config.LOG_FILE, "a") as f:
                    f.write(line + "\n")
            except OSError:
                pass

    # theme / wallpaper
    def _read_theme(self):
        scheme = _gsettings("org.gnome.desktop.interface", "color-scheme") or "default"
        dark = scheme == "prefer-dark"
        uri = _gsettings("org.gnome.desktop.background", "picture-uri-dark" if dark else "picture-uri")
        uri = uri or _gsettings("org.gnome.desktop.background", "picture-uri")
        path = None
        if uri and uri.startswith("file://"):
            p = unquote(uri[7:])
            if os.path.isfile(p) and not p.endswith(".xml"):
                path = p
        version = None
        if path:
            st = os.stat(path)
            version = hashlib.sha1(f"{path}{st.st_mtime}".encode()).hexdigest()[:10]
        return {"dark": dark, "wallpaper": path, "wallpaperVersion": version}

    def public_theme(self):
        t = self.theme
        return {"dark": t["dark"], "wallpaper": f"/wallpaper?v={t['wallpaperVersion']}" if t["wallpaper"] else None}

    def watch_loop(self):
        """Poll for widget file changes (hot reload) and theme/wallpaper changes."""
        tick = 0
        while True:
            time.sleep(1)
            tick += 1
            try:
                changed, list_changed = self.registry.scan()
                for wid in changed:
                    self.log(f"[reload] {wid}")
                    self.bus.emit("widget-changed", self.registry.get(wid))
                if list_changed:
                    self.bus.emit("widgets", self.registry.public())
                if tick % 3 == 0:
                    theme = self._read_theme()
                    if theme != self.theme:
                        self.theme = theme
                        self.bus.emit("theme", self.public_theme())
            except Exception as e:  # noqa: BLE001 - keep the watcher alive
                self.log(f"[watch] {e}")

    # API
    def _require_perm(self, params, perm):
        m = self.registry.get(params.get("widget", ""))
        if not m or perm not in m.get("permissions", []):
            raise PermissionError(f"widget needs '{perm}' permission in widget.json")

    def api(self, method, p):
        if method == "state":
            return {"widgets": self.registry.public(), "layout": self.store.load_layout(),
                    "theme": self.public_theme(), "config": self.store.config,
                    "host": self.host.info() if self.host else None}
        if method == "layout.save":
            self.layout_cache = p["layout"]
            self.store.save_layout(p["layout"])
            return True
        if method == "storage.get":
            return self.store.storage_get(p["scope"])
        if method == "storage.set":
            self.store.storage_set(p["scope"], p["data"])
            return True
        if method == "storage.delete":
            self.store.storage_delete(p["scope"])
            return True
        if method == "log":
            self.log(f"[{p.get('source', 'shell')}] {p.get('level', 'info')}: {p.get('message', '')}")
            return True
        if method == "notify":
            subprocess.Popen(["notify-send", "-a", "WidgetSystem", str(p.get("title", "")), str(p.get("body", ""))])
            return True
        if method == "stats":
            return self.sys.stats()
        if method == "apps":
            return desktop.apps()
        if method == "desktopItems":
            return desktop.desktop_items()
        if method == "host.pointer":
            if self.host:
                self.host.set_pointer_tracking(bool(p.get("on")))
            return bool(self.host)
        if method == "host.focus":
            if self.host:
                self.host.focus()
            return bool(self.host)
        if method == "open":
            subprocess.Popen(["xdg-open", str(p["url"])], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return True
        if method == "run":
            self._require_perm(p, "shell")
            r = subprocess.run(p["cmd"], shell=True, capture_output=True, text=True, timeout=p.get("timeout", 15))
            return {"code": r.returncode, "stdout": r.stdout, "stderr": r.stderr}
        if method == "fetch":
            self._require_perm(p, "network")
            body = p.get("body")
            req = urllib.request.Request(p["url"], method=p.get("method", "GET"), headers=p.get("headers") or {},
                                         data=body.encode() if isinstance(body, str) else None)
            req.add_header("User-Agent", req.get_header("User-agent") or "WidgetSystem/1")
            try:
                with urllib.request.urlopen(req, timeout=p.get("timeout", 20)) as r:
                    return {"status": r.status, "headers": dict(r.headers), "text": r.read().decode("utf-8", "replace")}
            except urllib.error.HTTPError as e:
                return {"status": e.code, "headers": dict(e.headers), "text": e.read().decode("utf-8", "replace")}
        if method == "host.inputRegion":
            if self.host:
                self.host.set_input_region(p.get("rects", []), p.get("full", False))
            return True
        if method == "host.devtools":
            if self.host:
                self.host.show_devtools()
            return bool(self.host)
        if method.startswith("ctl."):
            return self.ctl(method[4:], p)
        raise KeyError(f"unknown method {method}")

    def ctl(self, cmd, p):
        """Commands from widgetctl (or any script): forwarded to the shell as 'command' events."""
        if cmd == "list":
            return {"widgets": [{k: m[k] for k in ("id", "name", "description", "_dir")} for m in self.registry.public()],
                    "instances": (self.layout_cache or {}).get("instances", []),
                    "errors": self.registry.errors}
        if cmd == "path.add":
            path = str(Path(p["path"]).expanduser().resolve())
            paths = self.store.config.setdefault("widgetPaths", [])
            if path not in paths:
                paths.append(path)
                self.store.save_config()
            self.registry.scan()
            self.bus.emit("widgets", self.registry.public())
            return {"widgetPaths": paths, "found": [m["id"] for m in self.registry.public()]}
        if cmd == "path.remove":
            path = str(Path(p["path"]).expanduser().resolve())
            paths = self.store.config.setdefault("widgetPaths", [])
            if path in paths:
                paths.remove(path)
                self.store.save_config()
            return {"widgetPaths": paths}
        if cmd == "snapshot":
            if not self.host:
                raise RuntimeError("snapshot needs the desktop host (not --headless)")
            return self.host.snapshot(str(Path(p.get("path") or "/tmp/widgetsystem-snapshot.png").expanduser().resolve()))
        if cmd == "eval":
            if not self.host:
                raise RuntimeError("eval needs the desktop host (not --headless)")
            return self.host.eval_js(p["js"])
        if cmd == "devtools":
            return self.api("host.devtools", p)
        if cmd == "quit":
            if self.host:
                self.host.quit()
            else:
                threading.Timer(0.2, lambda: os._exit(0)).start()
            return True
        if cmd == "add" and not self.registry.get(p.get("widget", "").split(":")[0]):
            raise KeyError(f"no widget with id {p.get('widget')!r}; see `widgetctl list`")
        if not self.bus.clients:
            raise RuntimeError("no shell connected")
        self.bus.emit("command", {"cmd": cmd, **p})
        return True


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "WidgetSystem/1"
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            if app.debug:
                app.log("[http] " + fmt % args)

        def _send(self, code, body: bytes, ctype="application/json", extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _file(self, base: Path, rel: str):
            base = base.resolve()
            target = (base / rel).resolve()
            if not target.is_relative_to(base) or not target.is_file():
                return self._send(404, b"not found", "text/plain")
            ctype = MIME.get(target.suffix.lower()) or mimetypes.guess_type(str(target))[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/json", "image/svg+xml"):
                ctype += "; charset=utf-8"
            self._send(200, target.read_bytes(), ctype)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            url = urlparse(self.path)
            path = unquote(url.path)
            if path in ("/", "/index.html"):
                return self._file(config.SHELL_DIR, "index.html")
            if path.startswith("/shell/"):
                return self._file(config.SHELL_DIR, path[len("/shell/"):])
            if path.startswith("/w/"):
                # /w/<widget-id>/<version>/<file>; the version segment busts caches on hot reload
                parts = path.split("/", 4)
                m = app.registry.get(parts[2]) if len(parts) == 5 else None
                if not m:
                    return self._send(404, b"no such widget", "text/plain")
                return self._file(Path(m["_dir"]), parts[4])
            if path == "/icon":
                q = parse_qs(url.query)
                f = desktop.ICONS.lookup(q.get("name", [""])[0], int(q.get("size", ["64"])[0]))
                if not f:
                    return self._send(404, b"no icon", "text/plain")
                return self._file(Path(f).parent, Path(f).name)
            if path == "/wallpaper":
                wp = app.theme.get("wallpaper")
                if not wp:
                    return self._send(404, b"no wallpaper", "text/plain")
                return self._file(Path(wp).parent, Path(wp).name)
            if path == "/events":
                if parse_qs(url.query).get("token", [""])[0] != app.token:
                    return self._send(403, b"bad token", "text/plain")
                return self._events()
            self._send(404, b"not found", "text/plain")

        def _events(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            q = app.bus.subscribe()
            try:
                self.wfile.write(b"retry: 1000\n\n")
                self.wfile.flush()
                while True:
                    try:
                        ev = q.get(timeout=15)
                        self.wfile.write(f"data: {json.dumps(ev, ensure_ascii=False)}\n\n".encode())
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                pass
            finally:
                app.bus.unsubscribe(q)

        def do_POST(self):
            path = urlparse(self.path).path
            if not path.startswith("/api/"):
                return self._send(404, b"{}")
            if self.headers.get("X-WS-Token") != app.token:
                return self._send(403, json.dumps({"ok": False, "error": "bad token"}).encode())
            length = int(self.headers.get("Content-Length") or 0)
            try:
                params = json.loads(self.rfile.read(length) or b"{}")
                result = app.api(path[5:], params)
                body = {"ok": True, "result": result}
            except Exception as e:  # noqa: BLE001 - errors are returned to the caller
                body = {"ok": False, "error": f"{type(e).__name__}: {e}"}
                if not path.startswith("/api/log"):
                    app.log(f"[api] {path[5:]} failed: {body['error']}")
            self._send(200, json.dumps(body, ensure_ascii=False).encode())

    return Handler


def serve(app: App):
    httpd = ThreadingHTTPServer(("127.0.0.1", app.port), make_handler(app))
    httpd.daemon_threads = True
    threading.Thread(target=httpd.serve_forever, daemon=True, name="http").start()
    threading.Thread(target=app.watch_loop, daemon=True, name="watch").start()
    config.RUNTIME_FILE.write_text(json.dumps({"port": app.port, "token": app.token, "pid": os.getpid()}))
    os.chmod(config.RUNTIME_FILE, 0o600)
    app.log(f"WidgetSystem serving on http://127.0.0.1:{app.port}/?token={app.token}")
    return httpd
