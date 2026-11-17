"""Navigator: browse, install, update and remove widgets (like an editor's extensions view).

The index of known widgets is registry/index.json in the WidgetSystem repo. It is fetched from
GitHub (cached for an hour) and falls back to the cached copy, then to the copy in this checkout.

Security rules:
  * The client only ever sends a widget id. The git URL always comes from the index.
  * Only https://github.com/<owner>/<repo> URLs are cloned, with git run directly (no shell),
    with a timeout and without credential prompts.
  * Nothing from a cloned repo is executed here. A widget's code only runs later, inside the
    shell page, like any other widget.
  * A widget whose widget.json asks for more permissions than its index entry declares is
    refused, and "shell"/"network" must be accepted explicitly by the caller.
  * Removal only deletes folders inside USER_WIDGETS. Dev folders are only unregistered.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import config
from .registry import ID_RE, load_manifest

INDEX_URL = "https://raw.githubusercontent.com/NGdev2/WidgetSystem/main/registry/index.json"
LOCAL_INDEX = config.REPO / "registry" / "index.json"
CACHE_FILE = config.DATA_DIR / "navigator-index.json"
CACHE_TTL = 3600          # seconds a fetched index stays fresh
RETRY_AFTER = 300         # after a failed fetch, don't retry the network for this long (unless forced)
FETCH_TIMEOUT = 5
CLONE_TIMEOUT = 180
PULL_TIMEOUT = 120
REPO_RE = re.compile(r"^https://github\.com/[\w.-]+/[\w.-]+$")
DANGEROUS = ("shell", "network")   # permissions the user must accept explicitly

_lock = threading.Lock()           # one install/update/remove at a time
_last_fail = 0.0
_last_error = None
_remote_heads = {}                 # clone folder -> (checked at, remote HEAD sha or None)
HEAD_TTL = 600


class NavError(Exception):
    """A failure with a message meant for the user."""


# ---------------------------------------------------------------- index
def _clean_entry(e):
    """Keep only well-formed fields of an index entry; None if it is unusable."""
    if not isinstance(e, dict) or not ID_RE.match(str(e.get("id", ""))):
        return None
    strs = lambda v: [str(x) for x in v if isinstance(x, (str, int, float))] if isinstance(v, list) else []
    return {
        "id": str(e["id"]),
        "name": str(e.get("name") or e["id"]),
        "description": str(e.get("description") or ""),
        "repo": str(e.get("repo") or ""),
        "author": str(e.get("author") or ""),
        "icon": str(e.get("icon") or "🧩"),
        "tags": strs(e.get("tags")),
        "permissions": strs(e.get("permissions")),
        "variants": strs(e.get("variants")),
        "private": bool(e.get("private")),
    }


def _parse_index(data):
    if not isinstance(data, dict) or not isinstance(data.get("widgets"), list):
        raise ValueError("index has no 'widgets' list")
    entries = [c for c in (_clean_entry(e) for e in data["widgets"]) if c]
    seen, out = set(), []
    for e in entries:
        if e["id"] not in seen:
            seen.add(e["id"])
            out.append(e)
    return out


def _read_cache():
    try:
        c = json.loads(CACHE_FILE.read_text())
        return float(c["fetchedAt"]), _parse_index(c["index"])
    except (OSError, ValueError, KeyError, TypeError):
        return None, None


def load_index(refresh=False):
    """Returns (entries, meta). meta = {source: remote|cache|local, fetchedAt, error}."""
    global _last_fail, _last_error
    fetched_at, cached = _read_cache()
    now = time.time()
    if cached is not None and not refresh and now - fetched_at < CACHE_TTL:
        return cached, {"source": "cache", "fetchedAt": fetched_at, "error": None}
    error = None
    if refresh or now - _last_fail > RETRY_AFTER:
        try:
            req = urllib.request.Request(INDEX_URL, headers={"User-Agent": "WidgetSystem/1"})
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
                raw = json.loads(r.read().decode("utf-8"))
            entries = _parse_index(raw)
            config.DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = CACHE_FILE.with_suffix(".tmp")
            tmp.write_text(json.dumps({"fetchedAt": now, "index": raw}, ensure_ascii=False))
            tmp.replace(CACHE_FILE)
            return entries, {"source": "remote", "fetchedAt": now, "error": None}
        except (OSError, ValueError, urllib.error.URLError) as e:
            _last_fail, _last_error = now, f"online index unavailable ({e})"
            error = _last_error
    else:
        error = _last_error
    if cached is not None:
        return cached, {"source": "cache", "fetchedAt": fetched_at, "error": error}
    try:
        return _parse_index(json.loads(LOCAL_INDEX.read_text())), {"source": "local", "fetchedAt": None, "error": error}
    except (OSError, ValueError) as e:
        return [], {"source": "none", "fetchedAt": None, "error": f"{error}; no local index either ({e})"}


def _entry(wid):
    entries, _ = load_index()
    return next((e for e in entries if e["id"] == wid), None)


# ---------------------------------------------------------------- local state
def _user_root():
    return Path(config.USER_WIDGETS)


def _user_top(wdir: Path):
    """The folder directly inside USER_WIDGETS that holds this widget (it may be nested)."""
    rel = wdir.relative_to(_user_root())
    if not rel.parts:
        raise NavError("this widget sits directly in the widgets folder; remove it by hand")
    return _user_root() / rel.parts[0]


def _dev_path(app, wdir: Path):
    """The registered widgetPaths entry that contains this widget folder."""
    real = wdir.resolve()
    for p in app.store.config.get("widgetPaths", []):
        root = Path(p).expanduser().resolve()
        if real == root or real.is_relative_to(root):
            return p
    return None


def local_state(app, m):
    """Where an installed manifest comes from, and what the Navigator may do with it."""
    wdir = Path(m["_dir"])
    if m.get("_builtin"):
        return {"source": "builtin", "path": str(wdir), "updatable": False, "linked": False}
    if wdir.is_relative_to(_user_root()):
        top = _user_top(wdir) if wdir != _user_root() else wdir
        linked = top.is_symlink()
        return {"source": "user", "path": str(wdir), "linked": linked,
                "updatable": not linked and (top / ".git").exists()}
    return {"source": "dev", "path": str(wdir), "updatable": False, "linked": False, "devPath": _dev_path(app, wdir)}


def _manifest_view(m):
    icon = m.get("icon") or "🧩"
    if re.search(r"\.(png|svg|webp|jpe?g|gif)$", icon, re.I):
        icon = f"/w/{m['id']}/{m['_version']}/{icon}"
    return {
        "version": m.get("version"),
        "localIcon": icon,
        "manifestPermissions": list(m.get("permissions") or []),
        "variantInfo": [{"id": v["id"], "name": v["name"], "description": v.get("description", "")}
                        for v in m.get("variants") or []],
    }


def _merged(app, entries):
    out, seen = [], set()
    for e in entries:
        seen.add(e["id"])
        m = app.registry.get(e["id"])
        item = {**e, "inIndex": True, "installed": bool(m), "source": None, "version": None, "path": None,
                "updatable": False, "localIcon": None}
        if m:
            item.update(local_state(app, m), **_manifest_view(m))
        else:
            item["variantInfo"] = [{"id": v, "name": v.capitalize(), "description": ""} for v in e["variants"]]
        out.append(item)
    for m in app.registry.public():      # installed, but not in the index
        if m["id"] in seen:
            continue
        out.append({
            "id": m["id"], "name": m.get("name", m["id"]), "description": m.get("description", ""),
            "repo": m.get("repo") or m.get("homepage") or "", "author": m.get("author") or "",
            "icon": m.get("icon") or "🧩", "tags": [], "permissions": list(m.get("permissions") or []),
            "variants": [v["id"] for v in m.get("variants") or []], "private": False,
            "inIndex": False, "installed": True, **local_state(app, m), **_manifest_view(m),
        })
    return out


def _item(app, wid):
    entries, _ = load_index()
    return next((i for i in _merged(app, entries) if i["id"] == wid), None)


# ---------------------------------------------------------------- helpers
def _git(args, timeout, cwd=None):
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_ASKPASS": "true", "SSH_ASKPASS": "true"}
    try:
        r = subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
    except FileNotFoundError:
        raise NavError("git is not installed (sudo apt install git)") from None
    except subprocess.TimeoutExpired:
        raise NavError(f"git {args[0]} took longer than {timeout} s and was stopped") from None
    return r


def _git_err(r):
    lines = [ln for ln in (r.stderr or r.stdout or "").strip().splitlines() if ln.strip()]
    return lines[-1] if lines else f"exit code {r.returncode}"


def _check_permissions(wid, wanted, declared, accepted):
    """wanted: from widget.json; declared: from the index; accepted: what the user confirmed."""
    extra = [p for p in wanted if p not in declared]
    if extra:
        raise NavError(f"{wid}'s widget.json asks for permissions its index entry doesn't declare "
                       f"({', '.join(extra)}). Not installed.")
    missing = [p for p in wanted if p in DANGEROUS and p not in accepted]
    if missing:
        raise NavError(f"{wid} needs the {', '.join(missing)} permission. Confirm to install it.")


def _validate_manifest(folder: Path, wid):
    mpath = folder / "widget.json"
    if not mpath.is_file():
        raise NavError("the repository has no widget.json at its root")
    try:
        m = load_manifest(mpath)          # parses JSON only; never runs widget code
    except Exception as e:  # noqa: BLE001
        raise NavError(f"widget.json is invalid: {e}") from None
    if m["id"] != wid:
        raise NavError(f"widget.json has id {m['id']!r}, but the index says {wid!r}")
    return m


def _rescan(app, before):
    app.registry.scan()
    app.bus.emit("widgets", app.registry.public())
    gone = sorted(before - {m["id"] for m in app.registry.public()})
    for wid in gone:
        # The shell closes the instances of widgets that were uninstalled on purpose. (A plain
        # "widgets" event can also mean a manifest is briefly broken while being edited.)
        app.bus.emit("widget-removed", {"id": wid})
    return gone


def _update_available(path, force=False):
    """Compare the clone's HEAD with the remote's HEAD (git ls-remote; nothing is downloaded)."""
    top = str(_user_top(Path(path)))
    head = _git(["-C", top, "rev-parse", "HEAD"], 5).stdout.strip()
    ts, remote = _remote_heads.get(top, (0, None))
    if force or time.time() - ts > HEAD_TTL:
        try:
            r = _git(["-C", top, "ls-remote", "origin", "HEAD"], FETCH_TIMEOUT)
            remote = r.stdout.split()[0] if r.returncode == 0 and r.stdout.strip() else None
        except NavError:
            remote = None
        _remote_heads[top] = (time.time(), remote)
    return None if not remote or not head else remote != head


# ---------------------------------------------------------------- operations
def op_index(app, p):
    refresh = bool(p.get("refresh"))
    entries, meta = load_index(refresh=refresh)
    items = _merged(app, entries)
    if p.get("checkUpdates"):
        todo = [i for i in items if i.get("updatable")]
        with ThreadPoolExecutor(max_workers=4) as ex:
            for i, avail in zip(todo, ex.map(lambda i: _update_available(i["path"], refresh), todo)):
                i["updateAvailable"] = avail
    return {"widgets": items, **meta, "userWidgets": str(_user_root())}


def op_install(app, p):
    wid = str(p.get("id", ""))
    e = _entry(wid)
    if not e:
        raise NavError(f"{wid!r} is not in the widget index")
    if e["private"]:
        raise NavError(f"{e['name']} is not public yet (coming soon)")
    if not REPO_RE.match(e["repo"]):
        raise NavError(f"{e['name']} has no valid GitHub repository in the index")
    m = app.registry.get(wid)
    if m:
        where = {"builtin": "built in", "user": "already installed", "dev": "available as a dev folder"}
        raise NavError(f"{e['name']} is {where[local_state(app, m)['source']]} ({m['_dir']})")
    accepted = [str(x) for x in p.get("acceptPermissions") or []]
    _check_permissions(wid, [q for q in e["permissions"] if q in DANGEROUS], e["permissions"], accepted)
    root = _user_root()
    target = root / wid
    if target.exists() or target.is_symlink():
        raise NavError(f"{target} already exists; remove it first")
    root.mkdir(parents=True, exist_ok=True)
    # Clone into a hidden folder (the registry skips dot-folders), check it, then move it in place.
    tmp = root / f".installing-{wid}-{os.getpid()}"
    shutil.rmtree(tmp, ignore_errors=True)
    try:
        r = _git(["clone", "--depth", "1", "--no-tags", "--", e["repo"], str(tmp)], CLONE_TIMEOUT)
        if r.returncode != 0:
            raise NavError(f"git clone failed: {_git_err(r)}")
        m = _validate_manifest(tmp, wid)
        _check_permissions(wid, m.get("permissions") or [], e["permissions"], accepted)
        tmp.rename(target)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    app.log(f"[navigator] installed {wid} from {e['repo']}")
    _rescan(app, set())
    return _item(app, wid)


def op_update(app, p):
    wid = str(p.get("id", ""))
    m = app.registry.get(wid)
    if not m:
        raise NavError(f"{wid!r} is not installed")
    st = local_state(app, m)
    if st["source"] == "builtin":
        raise NavError("Built-in widgets update together with WidgetSystem itself")
    if st["source"] == "dev":
        raise NavError("This widget is a dev folder you manage yourself")
    if st["linked"]:
        raise NavError("This widget is a link to a folder you manage yourself")
    if not st["updatable"]:
        raise NavError("This widget wasn't installed with git; remove it and install it again")
    top = _user_top(Path(m["_dir"]))
    r = _git(["-C", str(top), "remote", "get-url", "origin"], 10)
    origin = r.stdout.strip()
    if r.returncode != 0 or not REPO_RE.match(origin.removesuffix(".git")):
        raise NavError(f"its git remote ({origin or 'none'}) isn't a GitHub https URL; update it by hand")
    before = _git(["-C", str(top), "rev-parse", "HEAD"], 10).stdout.strip()
    r = _git(["-C", str(top), "fetch", "--no-tags", "origin"], PULL_TIMEOUT)
    if r.returncode != 0:
        raise NavError(f"git fetch failed: {_git_err(r)}")
    up = _git(["-C", str(top), "rev-parse", "--verify", "@{upstream}"], 10).stdout.strip()
    if not up:
        raise NavError("its git checkout has no upstream branch; update it by hand")
    if up != before:
        # Look at the new widget.json before it lands on disk (hot reload would run it at once).
        shown = _git(["-C", str(top), "show", f"{up}:widget.json"], 10)
        try:
            new = json.loads(shown.stdout) if shown.returncode == 0 else None
        except ValueError:
            new = None
        if not isinstance(new, dict) or str(new.get("id", "")).lower() != wid:
            raise NavError("the new version has no valid widget.json for this id; not updated")
        old_perms = set(m.get("permissions") or [])
        new_dangerous = [q for q in new.get("permissions") or [] if q in DANGEROUS and q not in old_perms]
        e = _entry(wid)
        if e:
            _check_permissions(wid, new_dangerous, e["permissions"], [str(x) for x in p.get("acceptPermissions") or []])
        elif new_dangerous:
            raise NavError(f"the new version asks for new permissions ({', '.join(new_dangerous)}); update it by hand")
        r = _git(["-C", str(top), "merge", "--ff-only", up], PULL_TIMEOUT)   # = pull --ff-only
        if r.returncode != 0:
            raise NavError(f"can't fast-forward (local changes?): {_git_err(r)}")
    after = _git(["-C", str(top), "rev-parse", "HEAD"], 10).stdout.strip()
    _remote_heads.pop(str(top), None)
    app.registry.scan()
    nm = app.registry.get(wid)
    if after != before and nm:
        app.log(f"[navigator] updated {wid} {before[:7]} -> {after[:7]}")
        app.bus.emit("widget-changed", nm)
    app.bus.emit("widgets", app.registry.public())
    return {"updated": after != before, "from": before[:7], "to": after[:7], "widget": _item(app, wid)}


def op_remove(app, p):
    wid = str(p.get("id", ""))
    m = app.registry.get(wid)
    if not m:
        raise NavError(f"{wid!r} is not installed")
    st = local_state(app, m)
    before = {x["id"] for x in app.registry.public()}
    if st["source"] == "builtin":
        raise NavError("Built-in widgets can't be removed")
    if st["source"] == "dev":
        path = st.get("devPath")
        paths = app.store.config.setdefault("widgetPaths", [])
        if not path or path not in paths:
            raise NavError("couldn't find the registered folder for this widget; see `widgetctl path`")
        paths.remove(path)
        app.store.save_config()
        app.log(f"[navigator] unregistered dev folder {path}")
        gone = _rescan(app, before)
        return {"removed": gone, "kind": "unregistered", "path": path}
    top = _user_top(Path(m["_dir"]))
    if top.is_symlink():
        top.unlink()                       # a link to the user's own folder: drop only the link
        kind = "unlinked"
    else:
        real, root = top.resolve(), _user_root().resolve()
        if real == root or not real.is_relative_to(root):
            raise NavError(f"refusing to delete {real}: it is outside {root}")
        shutil.rmtree(real)
        kind = "deleted"
    app.log(f"[navigator] removed {wid} ({kind} {top})")
    gone = _rescan(app, before)
    return {"removed": gone, "kind": kind, "path": str(top)}


OPS = {"index": op_index, "install": op_install, "update": op_update, "remove": op_remove}


def handle(app, op, params):
    """Entry point for POST /api/nav.<op> and widgetctl's ctl.nav.<op>."""
    fn = OPS.get(op)
    if not fn:
        raise KeyError(f"unknown navigator operation {op!r}")
    if op == "index":
        return fn(app, params or {})
    if not _lock.acquire(timeout=1):
        raise NavError("another install, update or remove is still running")
    try:
        return fn(app, params or {})
    finally:
        _lock.release()
