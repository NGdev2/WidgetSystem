"""Paths, user config and persisted state (layout + per-widget storage)."""
import json
import os
import threading
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SHELL_DIR = REPO / "shell"
THEMES_DIR = REPO / "themes"
BUILTIN_WIDGETS = REPO / "widgets"

CONFIG_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "widgetsystem"
DATA_DIR = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "widgetsystem"
USER_WIDGETS = DATA_DIR / "widgets"
STORAGE_DIR = DATA_DIR / "storage"
LOG_FILE = DATA_DIR / "widgetsystem.log"
# One runtime file per running instance (solo widgets run as "solo-<id>" next to the full system).
INSTANCE = os.environ.get("WIDGETSYSTEM_INSTANCE", "widgetsystem")
RUNTIME_FILE = Path(os.environ.get("XDG_RUNTIME_DIR", "/tmp")) / f"{INSTANCE}.json"

DEFAULT_PORT = 47800

DEFAULT_CONFIG = {
    "port": DEFAULT_PORT,
    "widgetPaths": [],      # extra folders scanned for widgets
    "launcher": True,       # small corner button that opens the widget menu
    "launcherCorner": "bottom-right",
    "glassBlur": 28,        # px, strength of the wallpaper blur behind glass widgets
    "theme": "night-cron",  # a folder in themes/
    "tears": True,          # characters may tear full-screen widgets
}


def ensure_dirs():
    for d in (CONFIG_DIR, DATA_DIR, USER_WIDGETS, STORAGE_DIR):
        d.mkdir(parents=True, exist_ok=True)


def _read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def _write_json(path, data):
    path = Path(path)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    tmp.replace(path)


class Store:
    """Thread-safe access to config.json, layout.json and storage/*.json."""

    def __init__(self):
        ensure_dirs()
        self.lock = threading.Lock()
        self.config_path = CONFIG_DIR / "config.json"
        self.layout_path = CONFIG_DIR / "layout.json"
        self.config = {**DEFAULT_CONFIG, **_read_json(self.config_path, {})}
        if not self.config_path.exists():
            _write_json(self.config_path, self.config)

    # config
    def save_config(self):
        with self.lock:
            _write_json(self.config_path, self.config)

    def widget_paths(self):
        if self.config.get("solo"):   # standalone: only the one widget
            return [Path(p).expanduser() for p in self.config.get("widgetPaths", [])]
        paths = [BUILTIN_WIDGETS, USER_WIDGETS]
        paths += [Path(p).expanduser() for p in self.config.get("widgetPaths", [])]
        return paths

    # layout
    def load_layout(self):
        return _read_json(self.layout_path, None)

    def save_layout(self, layout):
        with self.lock:
            _write_json(self.layout_path, layout)

    # storage
    @staticmethod
    def _storage_file(scope):
        safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in scope)
        return STORAGE_DIR / f"{safe}.json"

    def storage_get(self, scope):
        return _read_json(self._storage_file(scope), {})

    def storage_set(self, scope, data):
        with self.lock:
            _write_json(self._storage_file(scope), data)

    def storage_delete(self, scope):
        try:
            self._storage_file(scope).unlink()
        except OSError:
            pass
