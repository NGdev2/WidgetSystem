"""Lightweight system stats from /proc and /sys (no dependencies)."""
import glob
import os
import shutil
import time


class SysInfo:
    def __init__(self):
        self._cached = None
        self._cached_at = 0.0
        self._cpu = self._read_cpu()
        self._net = (self._read_net(), time.monotonic())

    @staticmethod
    def _read_cpu():
        with open("/proc/stat") as f:
            parts = [int(x) for x in f.readline().split()[1:]]
        idle = parts[3] + (parts[4] if len(parts) > 4 else 0)
        return idle, sum(parts)

    @staticmethod
    def _read_net():
        rx = tx = 0
        try:
            with open("/proc/net/dev") as f:
                for line in f.readlines()[2:]:
                    name, data = line.split(":", 1)
                    if name.strip() == "lo":
                        continue
                    cols = data.split()
                    rx += int(cols[0])
                    tx += int(cols[8])
        except OSError:
            pass
        return rx, tx

    def cpu_percent(self):
        idle, total = self._read_cpu()
        pidle, ptotal = self._cpu
        self._cpu = (idle, total)
        dt = total - ptotal
        return round(100.0 * (1 - (idle - pidle) / dt), 1) if dt > 0 else 0.0

    @staticmethod
    def mem():
        info = {}
        with open("/proc/meminfo") as f:
            for line in f:
                k, v = line.split(":", 1)
                info[k] = int(v.split()[0]) * 1024
        total = info.get("MemTotal", 0)
        used = total - info.get("MemAvailable", info.get("MemFree", 0))
        return {"used": used, "total": total, "percent": round(100 * used / total, 1) if total else 0}

    @staticmethod
    def battery():
        for bat in sorted(glob.glob("/sys/class/power_supply/BAT*")):
            try:
                cap = int(open(f"{bat}/capacity").read().strip())
                status = open(f"{bat}/status").read().strip()
                return {"percent": cap, "status": status}
            except (OSError, ValueError):
                continue
        return None

    @staticmethod
    def temp():
        best = None
        for zone in glob.glob("/sys/class/thermal/thermal_zone*"):
            try:
                kind = open(f"{zone}/type").read().strip()
                t = int(open(f"{zone}/temp").read().strip()) / 1000
            except (OSError, ValueError):
                continue
            if kind in ("x86_pkg_temp", "TCPU", "cpu-thermal", "k10temp"):
                return round(t, 1)
            if best is None and 0 < t < 120:
                best = round(t, 1)
        return best

    def net(self):
        (rx, tx), now = self._read_net(), time.monotonic()
        (prx, ptx), pnow = self._net
        self._net = ((rx, tx), now)
        dt = max(now - pnow, 1e-3)
        return {"rx": int((rx - prx) / dt), "tx": int((tx - ptx) / dt)}

    def stats(self):
        # Several widgets poll; caching for 1 s keeps the CPU/net deltas over a sane window.
        now = time.monotonic()
        if self._cached and now - self._cached_at < 1.0:
            return self._cached
        self._cached, self._cached_at = self._collect(), now
        return self._cached

    def _collect(self):
        disk = shutil.disk_usage("/")
        with open("/proc/uptime") as f:
            uptime = float(f.read().split()[0])
        return {
            "cpu": self.cpu_percent(),
            "mem": self.mem(),
            "battery": self.battery(),
            "load": os.getloadavg(),
            "uptime": uptime,
            "temp": self.temp(),
            "net": self.net(),
            "disk": {"used": disk.used, "total": disk.total, "percent": round(100 * disk.used / disk.total, 1)},
        }
