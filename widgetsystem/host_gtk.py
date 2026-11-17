"""Desktop host for Linux/X11: one transparent, undecorated WebKit window that lives
below all normal windows, is hidden from Alt-Tab/taskbar/overview, and only accepts
mouse input where widgets actually are (XShape input region). Everything else
clicks through to the desktop.
"""
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
gi.require_foreign("cairo")
import cairo  # noqa: E402
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402


class GtkHost:
    def __init__(self, app):
        self.app = app
        self._region_key = None
        self.win = Gtk.Window(title="WidgetSystem")
        self.win.set_wmclass("widgetsystem", "WidgetSystem")
        self.win.set_decorated(False)
        self.win.set_skip_taskbar_hint(True)
        self.win.set_skip_pager_hint(True)
        self.win.set_keep_below(True)
        self.win.set_resizable(False)
        self.win.stick()
        self.win.set_app_paintable(True)

        screen = self.win.get_screen()
        visual = screen.get_rgba_visual()
        if visual is not None and screen.is_composited():
            self.win.set_visual(visual)
        else:
            app.log("[host] warning: no compositing / RGBA visual, transparency unavailable")

        self._place()
        screen.connect("monitors-changed", lambda *_: self._place(notify=True))

        settings = WebKit2.Settings()
        settings.set_enable_developer_extras(True)
        settings.set_enable_write_console_messages_to_stdout(app.debug)
        settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.ALWAYS)
        self.view = WebKit2.WebView.new_with_settings(settings)
        self.view.set_background_color(Gdk.RGBA(0, 0, 0, 0))
        self.view.connect("context-menu", lambda *_: True)  # the shell draws its own menus
        self.view.connect("web-process-terminated", self._on_crash)
        # A click on a widget should give the layer keyboard focus (typing, Esc). Connected on
        # the view because WebKit consumes the press before the window would see it.
        self.view.connect("button-press-event", self._on_press)
        self.win.add(self.view)
        self.win.connect("destroy", lambda *_: Gtk.main_quit())
        self.win.connect("realize", lambda *_: self._apply_region([], False))

        self.view.load_uri(f"http://127.0.0.1:{app.port}/?token={app.token}&host=gtk")
        self.win.show_all()
        self._apply_region([], False)

    def _place(self, notify=False):
        display = Gdk.Display.get_default()
        mon = display.get_primary_monitor() or display.get_monitor(0)
        # Use the work area (not the full monitor): an undecorated screen-sized window
        # would be treated as fullscreen by Mutter and jump above everything.
        wa, geo = mon.get_workarea(), mon.get_geometry()
        self.geom = {"origin": {"x": wa.x, "y": wa.y}, "size": {"w": wa.width, "h": wa.height},
                     "monitor": {"x": geo.x, "y": geo.y, "w": geo.width, "h": geo.height},
                     "scale": mon.get_scale_factor()}
        self.win.move(wa.x, wa.y)
        self.win.set_size_request(wa.width, wa.height)
        self.win.resize(wa.width, wa.height)
        if notify:
            self.app.bus.emit("host", self.info())

    def info(self):
        return {"kind": "gtk-x11", **self.geom}

    def _on_crash(self, view, reason):
        self.app.log(f"[host] web process terminated ({reason}), reloading")
        GLib.timeout_add(1000, lambda: (view.reload(), False)[1])

    # called from HTTP threads
    def set_input_region(self, rects, full):
        GLib.idle_add(self._apply_region, rects, full)

    def show_devtools(self):
        GLib.idle_add(lambda: self.view.get_inspector().show())

    # Global pointer: X11 lets us read the cursor even where the window is click-through.
    def set_pointer_tracking(self, on):
        GLib.idle_add(self._set_pointer_tracking, on)

    def _set_pointer_tracking(self, on):
        if on and not getattr(self, "_ptr_timer", None):
            self._ptr_last = None
            self._ptr_timer = GLib.timeout_add(33, self._poll_pointer)
        elif not on and getattr(self, "_ptr_timer", None):
            GLib.source_remove(self._ptr_timer)
            self._ptr_timer = None
        return False

    def _poll_pointer(self):
        seat = Gdk.Display.get_default().get_default_seat()
        _, x, y = seat.get_pointer().get_position()
        pos = (x - self.geom["origin"]["x"], y - self.geom["origin"]["y"])
        if pos != self._ptr_last:
            self._ptr_last = pos
            self.view.evaluate_javascript(f"window.__wsPointer&&window.__wsPointer({pos[0]},{pos[1]})", -1,
                                          None, None, None, None, None)
        return True

    def _on_press(self, _view, event):
        if not self.win.is_active():
            self.win.present_with_time(event.time)
        return False

    def focus(self):
        def do():
            self.win.present_with_time(Gdk.CURRENT_TIME)
            self.view.grab_focus()
            return False
        GLib.idle_add(do)

    def eval_js(self, script):
        """Run JavaScript in the shell page (dev/testing). Returns the result as JSON text."""
        import threading
        done = threading.Event()
        result = {}

        def finished(view, res):
            try:
                value = view.evaluate_javascript_finish(res)
                result["value"] = value.to_json(0) if not value.is_undefined() else None
            except Exception as e:  # noqa: BLE001
                result["error"] = str(e)
            done.set()

        GLib.idle_add(lambda: self.view.evaluate_javascript(script, -1, None, None, None, finished) and False)
        done.wait(10)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result.get("value")

    def snapshot(self, path):
        """Render the widget layer (transparent background) to a PNG. Blocks until written."""
        import threading
        done = threading.Event()
        result = {}

        def finished(view, res):
            try:
                surface = view.get_snapshot_finish(res)
                surface.write_to_png(path)
                result["path"] = path
            except Exception as e:  # noqa: BLE001
                result["error"] = str(e)
            done.set()

        GLib.idle_add(lambda: self.view.get_snapshot(
            WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.TRANSPARENT_BACKGROUND, None, finished) and False)
        done.wait(10)
        if "error" in result:
            raise RuntimeError(result["error"])
        return result.get("path")

    def quit(self):
        GLib.idle_add(Gtk.main_quit)

    def _apply_region(self, rects, full):
        key = ("full",) if full else tuple(tuple(int(v) for v in r) for r in rects)
        if key == self._region_key or not self.win.get_realized():
            return False
        self._region_key = key
        if full:
            self.win.input_shape_combine_region(None)
        else:
            region = cairo.Region([cairo.RectangleInt(int(x), int(y), max(1, int(w)), max(1, int(h)))
                                   for x, y, w, h in rects])
            self.win.input_shape_combine_region(region)
        return False

    def run(self):
        Gtk.main()
