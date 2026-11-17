"""Entry point: `python3 -m widgetsystem [--headless] [--port N] [--debug] [--solo DIR [--variant a,b] [--theme ID]]`."""
import argparse
import hashlib
import json
import os
import signal
import sys
import time
import urllib.request
from pathlib import Path

config = None  # imported in main(), after solo mode has set up its own paths


def _already_running(port):
    try:
        info = json.loads(config.RUNTIME_FILE.read_text())
        req = urllib.request.Request(f"http://127.0.0.1:{info['port']}/api/ctl.list", data=b"{}",
                                     headers={"X-WS-Token": info["token"]})
        urllib.request.urlopen(req, timeout=1)
        return True
    except Exception:  # noqa: BLE001
        return False


def setup_solo(args):
    """Standalone mode: separate config/data dirs, runtime file and port, so a solo widget never
    touches (or collides with) a full WidgetSystem running at the same time."""
    wdir = Path(args.solo).expanduser().resolve()
    manifest = json.loads((wdir / "widget.json").read_text())
    wid = manifest.get("id") or wdir.name
    home = Path.home()
    os.environ["XDG_CONFIG_HOME"] = str(home / ".config" / "widgetsystem-solo" / wid)
    os.environ["XDG_DATA_HOME"] = str(home / ".local/share" / "widgetsystem-solo" / wid)
    os.environ["WIDGETSYSTEM_INSTANCE"] = f"solo-{wid}"
    args.solo_dir, args.solo_id, args.solo_manifest = wdir, wid, manifest
    return 47810 + int(hashlib.sha1(wid.encode()).hexdigest(), 16) % 190


def write_solo_config(args):
    m = args.solo_manifest
    variants = args.variant.split(",") if args.variant else [v["id"] for v in m.get("variants") or []]
    store = config.Store()
    store.config.update({
        "solo": True, "port": args.port, "widgetPaths": [str(args.solo_dir)], "launcher": False,
        "soloWidget": args.solo_id, "soloVariants": variants,
        # an explicit --theme wins, then a theme chosen earlier (widgetctl theme), then the widget's own
        "theme": args.theme or (store.config.get("theme") if store.config.get("solo") else None) or m.get("theme", "night-cron"),
    })
    store.save_config()


def main():
    ap = argparse.ArgumentParser(prog="widgetsystem")
    ap.add_argument("--headless", action="store_true", help="server only; open the shell in a browser")
    ap.add_argument("--port", type=int)
    ap.add_argument("--debug", action="store_true")
    ap.add_argument("--solo", metavar="DIR", help="run one widget standalone, without the full system")
    ap.add_argument("--variant", help="solo: comma-separated variants to show (default: all)")
    ap.add_argument("--theme", help="solo: theme id (default: the widget's \"theme\" or night-cron)")
    args = ap.parse_args()
    if args.solo:
        args.port = args.port or setup_solo(args)
    global config
    from . import config as _config
    config = _config
    if args.solo:
        write_solo_config(args)

    if _already_running(args.port):
        print("WidgetSystem is already running (widgetctl quit to stop it)")
        sys.exit(1)

    from .server import App, serve
    app = App(port=args.port, debug=args.debug)
    serve(app)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))

    if args.headless:
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            pass
        return

    from .host_gtk import GtkHost
    signal.signal(signal.SIGINT, signal.SIG_DFL)
    app.host = GtkHost(app)
    app.host.run()


if __name__ == "__main__":
    main()
