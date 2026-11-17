"""Discovers widgets (folders with widget.json) and detects changes for hot reload."""
import json
import os
import re
from pathlib import Path

from .config import BUILTIN_WIDGETS as _BUILTIN

BUILTIN_DIR = _BUILTIN.resolve()
SKIP_DIRS = {"node_modules", ".git", "__pycache__", "dist", "build", ".venv", "solo"}   # solo/ = a bundled runner
# Hot reload watches only what a widget runs: not docs, trackers, tests or notes.
WATCH_SKIP_DIRS = SKIP_DIRS | {"docs", "tracker", "test", "tests"}
WATCH_SKIP_EXT = {".md", ".txt", ".log"}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")

MANIFEST_DEFAULTS = {
    "version": "0.0.0",
    "description": "",
    "icon": "🧩",
    "entry": "main.js",
    "styles": [],
    "expandable": True,
    "multiInstance": True,
    "permissions": [],
    "settings": [],
}
SIZE_DEFAULTS = {"w": 260, "h": 180, "minW": 80, "minH": 60, "maxW": None, "maxH": None, "resizable": True}
FRAME_DEFAULTS = {
    "look": "glass", "title": None, "showTitle": False, "border": True, "shadow": True,
    "radius": 18, "padding": 14, "overflow": "hidden", "tint": None, "controls": True, "dragAnywhere": True,
}


def _find_manifests(root: Path, depth=2):
    if not root.is_dir():
        return
    if (root / "widget.json").is_file():
        yield root / "widget.json"
        return
    if depth == 0:
        return
    try:
        children = sorted(root.iterdir())
    except OSError:
        return
    for child in children:
        if child.is_dir() and child.name not in SKIP_DIRS and not child.name.startswith("."):
            yield from _find_manifests(child, depth - 1)


def _dir_version(path: Path) -> str:
    """Newest mtime of any file in the widget folder (cheap change detection)."""
    newest = 0.0
    count = 0
    for dirpath, dirnames, filenames in os.walk(path):
        dirnames[:] = [d for d in dirnames if d not in WATCH_SKIP_DIRS and not d.startswith(".")]
        for f in filenames:
            if os.path.splitext(f)[1].lower() in WATCH_SKIP_EXT:
                continue
            try:
                newest = max(newest, os.stat(os.path.join(dirpath, f)).st_mtime)
            except OSError:
                pass
            count += 1
            if count > 2000:
                break
    return f"{int(newest * 1000):x}"


def load_manifest(path: Path):
    data = json.loads(path.read_text())
    wdir = path.parent
    m = {**MANIFEST_DEFAULTS, **data}
    m["id"] = str(m.get("id") or wdir.name).lower()
    if not ID_RE.match(m["id"]):
        raise ValueError(f"invalid widget id {m['id']!r}")
    m.setdefault("name", m["id"])
    m["size"] = {**SIZE_DEFAULTS, **(data.get("size") or {})}
    m["frame"] = {**FRAME_DEFAULTS, **(data.get("frame") or {})}
    if m["frame"]["title"] is None:
        m["frame"]["title"] = m["name"]
    styles = list(m["styles"])
    if not styles and (wdir / "style.css").is_file():
        styles = ["style.css"]
    m["styles"] = styles
    # Variants: one widget folder, several gallery entries (e.g. a Day and a Week view
    # sharing code and ctx.shared data). Each variant can override size, frame and settings.
    variants = []
    for v in data.get("variants") or []:
        if not isinstance(v, dict) or not ID_RE.match(str(v.get("id", ""))):
            raise ValueError(f"variant needs an id matching [a-z0-9-]: {v!r}")
        variants.append({
            "id": v["id"], "name": v.get("name", v["id"]), "description": v.get("description", m["description"]),
            "icon": v.get("icon", m["icon"]), "size": {**m["size"], **(v.get("size") or {})},
            "frame": {"title": v.get("name", v["id"]), **(v.get("frame") or {})}, "settings": v.get("settings") or {},
        })
    m["variants"] = variants
    m["_dir"] = str(wdir)
    m["_builtin"] = wdir.resolve().is_relative_to(BUILTIN_DIR)
    m["_version"] = _dir_version(wdir)
    return m


class Registry:
    def __init__(self, store, log):
        self.store = store
        self.log = log
        self.widgets = {}   # id -> manifest
        self.errors = {}    # manifest path -> error string

    def scan(self):
        """Rescan all widget paths. Returns (changed_ids, list_changed)."""
        found, errors = {}, {}
        for root in self.store.widget_paths():
            for mpath in _find_manifests(Path(root)):
                try:
                    m = load_manifest(mpath)
                except Exception as e:  # noqa: BLE001 - report any manifest problem
                    errors[str(mpath)] = str(e)
                    continue
                if m["id"] in found:
                    continue  # first path wins (builtin < user < extra)
                found[m["id"]] = m
        for p, e in errors.items():
            if self.errors.get(p) != e:
                self.log(f"[registry] bad manifest {p}: {e}")
        changed = [i for i, m in found.items() if i in self.widgets and self.widgets[i]["_version"] != m["_version"]]
        list_changed = set(found) != set(self.widgets)
        self.widgets, self.errors = found, errors
        return changed, list_changed

    def public(self):
        return list(self.widgets.values())

    def get(self, wid):
        return self.widgets.get(wid)
