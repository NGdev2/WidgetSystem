#!/usr/bin/env python3
"""Start an isolated WidgetSystem with demo data for screenshots/recordings (never touches your
real config or storage). Usage:

  tools/promo/demo_instance.py DIR [--theme night-cron|glass] [--port 47831]

Then drive it with:  XDG_RUNTIME_DIR=DIR/run bin/widgetctl …   and stop it with `… quit`.
Widget projects are looked up next to this repo (../CyberTasks, ../DeskSprite)."""
import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROJECTS = REPO.parent


def day(offset=0):
    return (dt.date.today() + dt.timedelta(days=offset)).isoformat()


def week_key(d):
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def demo_db():
    today = dt.date.today()
    wk = week_key(today)
    monday = today - dt.timedelta(days=today.isoweekday() - 1)
    items, done = [], {}

    def item(title, repeat, scope="day", created=None, order=None):
        iid = f"demo{len(items)}"
        items.append({"id": iid, "title": title, "scope": scope, "repeat": repeat,
                      "created": created or day(-20), "order": order if order is not None else len(items)})
        return iid

    read = item("Read 30 pages", {"type": "daily"})
    item("Gym", {"type": "weekly", "days": [1, 3, 5]})
    item("Water the plants", {"type": "daily", "every": 3}, created=day(0))
    item("Pay rent", {"type": "monthly", "day": 1})
    item("Mom's birthday", {"type": "yearly", "month": 3, "day": 14})
    review = item("Review 3 pull requests", {"type": "once", "date": day(0)})
    item("Ship v1.2 release notes", {"type": "once", "date": day(0)})
    item("Call the dentist", {"type": "once", "date": day(-1)})            # shows as overdue
    item("Team retro", {"type": "once", "date": (monday + dt.timedelta(days=2)).isoformat()})
    item("Dentist 15:00", {"type": "once", "date": (monday + dt.timedelta(days=3)).isoformat()})
    item("Release v1.2", {"type": "once", "date": (monday + dt.timedelta(days=4)).isoformat()})
    item("Inbox zero", {"type": "weekly"}, scope="week")
    item("Write the launch post", {"type": "once", "week": wk}, scope="week")
    ci = item("Fix the flaky CI job", {"type": "once", "week": wk}, scope="week")
    now = int(dt.datetime.now().timestamp() * 1000)
    for k in range(0, 6):
        done[f"{read}@{day(-k)}"] = {"at": now}
    done[f"{review}@{day(0)}"] = {"at": now}
    done[f"{ci}@{wk}"] = {"at": now}
    return {"v": 1, "items": items, "done": done}


def layout(w=1920, h=1048):
    inst = lambda i, widget, x, y, ww, hh, variant=None: {  # noqa: E731
        "id": i, "widget": widget, **({"variant": variant} if variant else {}), "x": x, "y": y, "w": ww, "h": hh,
        "style": {}, "settings": {}, "expanded": False}
    return {"version": 1, "instances": [
        inst("clock-demo", "clock", w - 324, 24, 300, 176),
        inst("sysmon-demo", "sysmon", w - 324 - 256, 24, 240, 190),
        inst("day-demo", "cybertasks", w - 384, 222, 360, 440, "day"),
        inst("week-demo", "cybertasks", 520, h - 400, 940, 360, "week"),
        inst("desksprite-demo", "desksprite", 40, h - 470, 270, 196),
        inst("fsck-demo", "fsck", 40, h - 200, 220, 150),
        inst("pet-demo", "pet", 290, h - 200, 220, 150),
    ]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dir")
    ap.add_argument("--theme", default="night-cron")
    ap.add_argument("--port", type=int, default=47831)
    a = ap.parse_args()
    d = Path(a.dir).resolve()
    cfg, data, run = d / "cfg" / "widgetsystem", d / "data" / "widgetsystem", d / "run"
    for p in (cfg, data / "storage", run):
        p.mkdir(parents=True, exist_ok=True)
    paths = [str(PROJECTS / n) for n in ("CyberTasks", "DeskSprite") if (PROJECTS / n / "widget.json").exists()]
    (cfg / "config.json").write_text(json.dumps({"port": a.port, "widgetPaths": paths, "theme": a.theme, "launcher": True}))
    (cfg / "layout.json").write_text(json.dumps(layout()))
    (data / "storage" / "w-cybertasks.json").write_text(json.dumps({"db": demo_db(), "pruned": day(0)}))
    (data / "storage" / "i-pet-demo.json").write_text(json.dumps({"stats": {"food": 82, "fun": 74, "energy": 90, "t": dt.datetime.now().timestamp()}}))
    env = {**os.environ, "XDG_CONFIG_HOME": str(d / "cfg"), "XDG_DATA_HOME": str(d / "data"), "XDG_RUNTIME_DIR": str(run)}
    subprocess.Popen([sys.executable, "-m", "widgetsystem"], cwd=REPO, env=env, start_new_session=True,
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"demo started on port {a.port}; drive it with: XDG_RUNTIME_DIR={run} bin/widgetctl …")


if __name__ == "__main__":
    main()
