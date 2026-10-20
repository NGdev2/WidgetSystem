"""Entry point: `python3 -m widgetsystem [--headless] [--port N] [--debug]`."""
import argparse
import json
import signal
import sys
import time
import urllib.request

from . import config


def _already_running(port):
    try:
        info = json.loads(config.RUNTIME_FILE.read_text())
        req = urllib.request.Request(f"http://127.0.0.1:{info['port']}/api/ctl.list", data=b"{}",
                                     headers={"X-WS-Token": info["token"]})
        urllib.request.urlopen(req, timeout=1)
        return True
    except Exception:  # noqa: BLE001
        return False


def main():
    ap = argparse.ArgumentParser(prog="widgetsystem")
    ap.add_argument("--headless", action="store_true", help="server only; open the shell in a browser")
    ap.add_argument("--port", type=int)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

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
