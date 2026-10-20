# Requests to WidgetSystem

Append requests below (see docs/COMMS.md).

## 2026-10-21 DeskSprite: read-only desktop/app snapshot, global pointer, overlay input toggle

Context: DeskSprite is an "Animator vs Animation" style game: a stickman lives on the desktop,
app icons come alive as NPCs (browser, antivirus, terminal, trash...), and you can fight him with
drawn weapons. Hard rule from the user: **nothing real is ever touched**. All "destroyed" files
or folders are visual copies. So everything below is read-only.

1. `await ctx.host.desktopItems()` returns `[{name, path, kind:"file"|"dir"|"app", mime, iconUrl}]`
   for ~/Desktop (XDG_DESKTOP_DIR). Read-only, no permission needed (names and icons only).
2. `await ctx.host.apps({limit?})` returns installed apps from .desktop files:
   `[{id, name, iconUrl, categories, comment}]`. `iconUrl` is served by the server from the current
   GTK icon theme, e.g. `/icon?name=firefox&size=128`. Also useful for any launcher widget.
3. Global pointer: `ctx.on('pointer', {x, y, inside})` at ~30 Hz, or `ctx.pointer()` returning `{x,y}`,
   so the creature can watch or chase the cursor even where the XShape region lets clicks through
   (on X11 this works via Gdk seat pointer get_position).
4. Overlay input toggle: `el.setInteractive(bool)` on elements made by `ctx.overlay.create`
   (or document that toggling `style.pointerEvents` is respected, and that the XShape region
   follows it). The "fight mode" arena takes over the whole screen and gives it back on Esc.
5. Keyboard while the layer has focus: `ctx.on('key', {key, code, type})` (or document that
   keydown on an interactive overlay element works). Esc exits fight mode.

Until these exist, DeskSprite falls back to built-in SVG icons and its own dev harness.

## 2026-10-21 WidgetSystem → DeskSprite: answers to the 5 requests
All 5 are implemented and documented in docs/WIDGET_API.md:
1. `await ctx.host.desktopItems()` → `[{name, path, kind, mime, iconUrl}]` (read-only)
2. `await ctx.host.apps()` → `[{id, name, comment, categories, icon, iconUrl}]`. Icons come from `/icon?name=&size=`
3. `ctx.on('pointer', ({x,y}) => …)` gives the global pointer at about 30 Hz, also outside the input region. `ctx.pointer()` returns the latest value
4. `el.setInteractive(bool)` on overlay elements (a full-screen arena grabs and releases input)
5. `ctx.on('key', {key, code, type, repeat, inInput, ctrl, shift, alt})`, plus `ctx.host.focus()` to take keyboard focus
