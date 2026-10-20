"""Read-only desktop information: icon theme lookup, installed apps, ~/Desktop items.

Pure filesystem parsing (no GTK) so it is thread-safe and works headless.
"""
import configparser
import mimetypes
import os
import subprocess
import threading
from pathlib import Path

ICON_EXT = (".svg", ".png", ".xpm")


def _data_dirs():
    home = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    dirs = [home] + [Path(d) for d in os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share").split(":") if d]
    dirs += [home / "flatpak/exports/share", Path("/var/lib/flatpak/exports/share"), Path("/var/lib/snapd/desktop")]
    seen, out = set(), []
    for d in dirs:
        if d not in seen and d.is_dir():
            seen.add(d)
            out.append(d)
    return out


def _gsetting(key):
    try:
        r = subprocess.run(["gsettings", "get", "org.gnome.desktop.interface", key], capture_output=True, text=True, timeout=2)
        return r.stdout.strip().strip("'") or None
    except (OSError, subprocess.SubprocessError):
        return None


class IconIndex:
    """name -> [(size, path)] over the current theme, its parents, hicolor and pixmaps."""

    def __init__(self):
        self._index = None
        self._lock = threading.Lock()

    def _themes(self, roots):
        order, queue = [], [_gsetting("icon-theme") or "Yaru"]
        while queue:
            t = queue.pop(0)
            if t in order:
                continue
            order.append(t)
            for r in roots:
                idx = r / t / "index.theme"
                if idx.is_file():
                    cp = configparser.ConfigParser(interpolation=None, strict=False)
                    try:
                        cp.read(idx)
                        queue += [p.strip() for p in cp.get("Icon Theme", "Inherits", fallback="").split(",") if p.strip()]
                    except configparser.Error:
                        pass
                    break
        if "hicolor" not in order:
            order.append("hicolor")
        return order

    def _build(self):
        roots = [Path.home() / ".icons"] + [d / "icons" for d in _data_dirs()]
        index = {}
        for rank, theme in enumerate(self._themes(roots)):
            for r in roots:
                base = r / theme
                if not base.is_dir():
                    continue
                for dirpath, _, files in os.walk(base):
                    parts = Path(dirpath).relative_to(base).parts
                    size = 512
                    for p in parts:
                        head = p.split("x")[0].split("@")[0]
                        if head.isdigit():
                            size = int(head)
                    for f in files:
                        name, ext = os.path.splitext(f)
                        if ext in ICON_EXT:
                            index.setdefault(name, []).append((rank, size, os.path.join(dirpath, f)))
        for d in _data_dirs():
            pix = d / "pixmaps"
            if pix.is_dir():
                for f in pix.iterdir():
                    if f.suffix in ICON_EXT:
                        index.setdefault(f.stem, []).append((99, 48, str(f)))
        return index

    def lookup(self, name, size=64):
        if not name:
            return None
        if os.path.isabs(name):
            return name if os.path.isfile(name) else None
        with self._lock:
            if self._index is None:
                self._index = self._build()
        cands = self._index.get(name)
        if not cands:
            return None
        best_rank = min(c[0] for c in cands)
        cands = [c for c in cands if c[0] == best_rank]
        # prefer the smallest icon >= size, then scalable svg, then the largest available
        bigger = sorted((c for c in cands if c[1] >= size and not c[2].endswith(".svg")), key=lambda c: c[1])
        svgs = [c for c in cands if c[2].endswith(".svg")]
        pick = (bigger or svgs or sorted(cands, key=lambda c: -c[1]))[0]
        return pick[2]


ICONS = IconIndex()


def icon_url(name, size=64):
    if not name:
        return None
    from urllib.parse import quote
    return f"/icon?name={quote(name)}&size={size}"


def _read_desktop_file(path):
    cp = configparser.ConfigParser(interpolation=None, strict=False)
    cp.optionxform = str
    try:
        cp.read(path, encoding="utf-8")
        return dict(cp["Desktop Entry"])
    except (configparser.Error, KeyError, UnicodeDecodeError):
        return None


def apps():
    out, seen = [], set()
    desktops = set((os.environ.get("XDG_CURRENT_DESKTOP") or "").split(":"))
    for d in _data_dirs():
        appdir = d if d.name == "desktop" else d / "applications"
        if not appdir.is_dir():
            continue
        for f in sorted(appdir.rglob("*.desktop")):
            app_id = f.name[:-8]
            if app_id in seen:
                continue
            seen.add(app_id)
            e = _read_desktop_file(f)
            if not e or e.get("Type") != "Application" or e.get("NoDisplay") == "true" or e.get("Hidden") == "true":
                continue
            only = e.get("OnlyShowIn")
            if only and not desktops & set(only.split(";")):
                continue
            if desktops & set(e.get("NotShowIn", "").split(";")):
                continue
            out.append({"id": app_id, "name": e.get("Name", app_id), "comment": e.get("Comment", ""),
                        "categories": [c for c in e.get("Categories", "").split(";") if c],
                        "icon": e.get("Icon"), "iconUrl": icon_url(e.get("Icon"), 128)})
    return sorted(out, key=lambda a: a["name"].lower())


def desktop_dir():
    try:
        r = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, timeout=2)
        p = Path(r.stdout.strip())
        if p.is_dir() and p != Path.home():
            return p
    except (OSError, subprocess.SubprocessError):
        pass
    return Path.home() / "Desktop"


def desktop_items():
    d = desktop_dir()
    if not d.is_dir():
        return []
    out = []
    for f in sorted(d.iterdir(), key=lambda p: p.name.lower()):
        if f.name.startswith("."):
            continue
        if f.is_dir():
            kind, mime, icon, name = "dir", "inode/directory", "folder", f.name
        elif f.suffix == ".desktop":
            e = _read_desktop_file(f) or {}
            kind, mime, icon, name = "app", "application/x-desktop", e.get("Icon"), e.get("Name", f.stem)
        else:
            mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            kind, name = "file", f.name
            major = mime.split("/")[0]
            icon = next((n for n in (mime.replace("/", "-"), f"{major}-x-generic", "text-x-generic")
                         if ICONS.lookup(n)), "text-x-generic")
        out.append({"name": name, "path": str(f), "kind": kind, "mime": mime, "iconUrl": icon_url(icon, 128)})
    return out
