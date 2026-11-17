# Widget API (v1)

This is the contract between **WidgetSystem** (the host) and **widgets** (DeskSprite, the
tasks widget, anything else). If you need something that is not here, ask: see
[COMMS.md](COMMS.md).

## 1. What a widget is

A widget is a folder with a `widget.json` manifest and an ES module entry file.

```
my-widget/
  widget.json
  main.js        # entry (ES module)
  style.css      # optional, injected into the widget's shadow root
  assets/...     # anything else, reachable via ctx.asset('assets/x.png')
```

WidgetSystem finds widgets in these places:

- `WidgetSystem/widgets/*` (the built-in examples)
- `~/.local/share/widgetsystem/widgets/*` (symlinks are fine)
- any extra path you register with `widgetctl path add <dir>`. Up to 2 folder levels
  below that path are scanned for `widget.json`, so a whole project repo can be
  registered (for example DeskSprite with a `widget/` subfolder, or with
  `widget.json` at its root).

**Hot reload:** saving any file in a widget folder remounts every instance of that
widget within about 1 second. Position, size, settings and storage are kept.

All widgets render inside **one** transparent, full-screen, below-all-apps window. They
are DOM elements, not separate OS windows. Each instance gets its own **shadow root**,
so your CSS cannot leak out and the page's CSS cannot leak in.

## 2. Manifest: `widget.json`

```jsonc
{
  "id": "desksprite",            // unique, [a-z0-9-]
  "name": "DeskSprite",
  "version": "0.1.0",
  "description": "A tiny creature that lives on your desktop",
  "icon": "🐣",                   // emoji, or a relative path to an image
  "entry": "main.js",            // default "main.js"
  "styles": ["style.css"],       // default [] (style.css is auto-added if it exists)

  "size": {                      // default size of a new instance (CSS px)
    "w": 240, "h": 200,
    "minW": 120, "minH": 100, "maxW": null, "maxH": null,
    "resizable": true
  },

  "frame": {                     // default look; the user can override it per instance
    "look": "glass",             // "glass" | "tint" | "solid" | "clear"
    "title": "DeskSprite",
    "showTitle": false,
    "border": true,
    "shadow": true,
    "radius": 18,
    "padding": 14,
    "overflow": "hidden",        // "visible" lets your content draw outside the box
    "tint": null,                // CSS color to override the glass tint
    "controls": true             // false hides the host's hover buttons (custom-chrome widgets)
  },

  "variants": [                  // optional: several gallery entries from one folder
    { "id": "day",  "name": "Daily Jobs",      "size": { "w": 340, "h": 420 }, "settings": { "view": "day" } },
    { "id": "week", "name": "Weekly Schedule", "size": { "w": 860, "h": 340 }, "settings": { "view": "week" },
      "frame": { "padding": 0 } }
  ],
  "expandable": true,            // can go full screen
  "multiInstance": true,
  "permissions": [],             // "shell" | "network" (see ctx.host)
  "settings": [                  // auto-generated settings dialog
    { "key": "name", "type": "string",  "label": "Pet name", "default": "Bloop" },
    { "key": "speed","type": "number",  "label": "Speed", "min": 0.5, "max": 3, "step": 0.1, "default": 1 },
    { "key": "talk", "type": "boolean", "label": "Talks", "default": true },
    { "key": "mood", "type": "select",  "label": "Mood", "options": ["calm","wild"], "default": "calm" },
    { "key": "color","type": "color",   "label": "Color", "default": "#7cc4ff" }
  ]
}
```

**Variants** share the widget's code and `ctx.shared` data, but each instance remembers
which variant it is (`ctx.variant`). A variant can override `size`, `frame` (including its
`title`) and default `settings`. `widgetctl add <widget>:<variant>` adds one from the shell.

Looks:

| look    | what it is |
|---------|------------|
| `glass` | frosted glass: a blurred sample of the wallpaper behind the widget, plus a tint (macOS-like) |
| `tint`  | plain translucent tint, no blur |
| `solid` | opaque card |
| `clear` | nothing: no background, border, shadow or title. Use it for creatures and floating things |

## 3. Entry module

```js
// main.js
export async function mount(ctx) {
  ctx.root.innerHTML = `<div class="hello">Hi ${ctx.settings.name}</div>`;
  const stop = ctx.every(1000, () => { /* tick */ });
  return () => { /* optional cleanup; every()/raf()/on()/overlay are auto-cleaned anyway */ };
}

export function unmount(ctx) {}   // optional, alternative to returning a cleanup function
```

`export default { mount, unmount }` also works.

If `mount` throws, the frame shows the error and a Reload button. The error also goes to
the log (see §6).

## 4. The `ctx` object

### Identity and content
| member | |
|---|---|
| `ctx.id` | instance id (stable across restarts) |
| `ctx.widget` | the manifest (with defaults filled) |
| `ctx.variant` | the variant id of this instance, or `null` |
| `ctx.root` | your content element (inside the shadow root) |
| `ctx.shadow` | the ShadowRoot |
| `ctx.asset(path)` | URL of a file in your widget folder |
| `ctx.log(...args)` | goes to the browser console **and** the WidgetSystem log file |

### Settings and storage (persisted to disk)
| member | |
|---|---|
| `ctx.settings` | current values (`settings` from the manifest, merged with user values) |
| `ctx.setSetting(key, value)` | change one setting programmatically (fires `settings`) |
| `ctx.openSettings()` | open the auto-generated settings dialog |
| `ctx.storage.get(key, def)` / `.set(key, val)` / `.delete(key)` / `.all()` | per-instance JSON storage. Synchronous reads, writes are debounced to disk |
| `ctx.shared` | same API, shared by all instances of this widget (for example, one pet's stats). Writes fire `shared` on the *other* instances |

### Frame (the window-like box)
| member | |
|---|---|
| `ctx.frame.setTitle(text)` / `ctx.frame.showTitle(bool)` | |
| `ctx.frame.setStyle({look, border, shadow, radius, padding, tint, overflow, showTitle})` | partial update |
| `ctx.frame.getStyle()` | |
| `ctx.frame.resize(w, h)` / `ctx.frame.moveTo(x, y)` / `ctx.frame.getRect()` | window coordinates, CSS px |
| `ctx.frame.expand()` / `.collapse()` / `.toggleExpand()` / `.isExpanded()` | full screen and back |
| `ctx.frame.close()` | remove this instance |
| `ctx.menu.add({label, action, icon?})` | add items to the right-click menu. Returns a remove function |

Dragging: by the title bar, with **Ctrl+drag** anywhere, from any element inside your
widget that has the `data-ws-drag` attribute (buttons, inputs, links and `[data-ws-nodrag]`
elements inside a handle stay clickable), or freely in edit mode.

### Events: `ctx.on(name, fn)` returns an `off()` function
| event | payload |
|---|---|
| `resize` | `{w, h}` (content box) |
| `move` | `{x, y}` |
| `expand` / `collapse` | — |
| `theme` | `{dark}` |
| `settings` | the new settings object |
| `message` | `{from: {id, widget}, data}` from another widget, or from `widgetctl send` |
| `layout` | `[{id, widget, rect, expanded}]` when any widget moves, resizes, appears or disappears |
| `shared` | `{key}`: another instance of this widget wrote `ctx.shared[key]`. Re-read and re-render |
| `editmode` | `{on}` |
| `visibility` | `{visible}` (when the user uses "Hide widgets") |
| `pointer` | `{x, y}`: the **global** mouse position in window coordinates, about 30 Hz, even where the layer is click-through. Tracking runs only while at least one widget listens |
| `key` | `{key, code, type: 'keydown'\|'keyup', repeat, inInput, ctrl, shift, alt}` while the widget layer has keyboard focus. `inInput` is true when the user is typing in some input; ignore those events for game controls |

### Timers (auto-cancelled on unmount)
- `ctx.every(ms, fn)` returns a stop function
- `ctx.after(ms, fn)` returns a cancel function
- `ctx.raf(fn(dt, t), {fps})` starts an animation loop with `dt` in seconds and returns a stop function. `fps` caps the rate (default 60). It pauses automatically while widgets are hidden

### Theme
- `ctx.theme` is `{dark: boolean}` and follows the GNOME light/dark setting.
- These CSS variables are available inside your shadow root: `--ws-fg`, `--ws-fg-muted`,
  `--ws-accent`, `--ws-surface` (a subtle fill for inputs and rows), `--ws-border`,
  `--ws-font`, `--ws-radius`.
- Optional helper classes (zero specificity, easy to override): `.ws-btn`,
  `.ws-btn.primary`, `.ws-input`, `.ws-check`, `.ws-muted`, `.ws-big`.

### Desktop-level effects (they can leave your box)
| member | |
|---|---|
| `ctx.say(text, {anchor?, duration?, typing?})` | speech bubble. `anchor` is an Element (it follows the element) or `{x, y}` in window coordinates. The default anchor is the top of the frame. Returns `{update(text), close()}` |
| `ctx.particles.burst(opts)` | system particle layer. opts: `x, y` (window coordinates, default: frame center), `preset` (`"confetti"`, `"hearts"`, `"sparkles"`, `"stars"`, `"smoke"`), `count`, `colors`, `emoji`, `speed`, `gravity`, `life`, `size`, `spread`, `angle` |
| `ctx.overlay.create({interactive?, className?, html?})` | returns a free-floating element positioned in **window coordinates** that can go anywhere on screen (a creature walking over other widgets). Your widget's styles apply to it. `interactive: true` makes it receive clicks |
| `el.setInteractive(bool)` | on an overlay element: start or stop receiving mouse input. A full-screen overlay set to interactive grabs the whole screen (a fight arena). Set it back to `false` to release |
| `ctx.pointer()` | last known global pointer `{x, y}` |
| `ctx.overlay.root` | the overlay's container (with its own shadow root and your styles) |
| `ctx.toWindow(x, y)` / `ctx.fromWindow(x, y)` | convert between content-local and window coordinates |
| `ctx.desktop.size()` | `{w, h}` of the widget layer |
| `ctx.desktop.widgets()` | `[{id, widget, rect:{x,y,w,h}, expanded}]` for standing on or avoiding other widgets |

### Messaging
- `ctx.send(target, data)` sends to a target that is an instance id, a widget id (all its
  instances), or `"*"`.
- Receive with `ctx.on('message', ({from, data}) => …)`.
- From the shell: `widgetctl send <target> '<json>'`. Scripts, cron jobs or another
  process can poke widgets this way.

### Host services: `await ctx.host.<method>(...)`
| method | permission | |
|---|---|---|
| `notify(title, body)` | — | native desktop notification |
| `stats()` | — | `{cpu, mem:{used,total,percent}, battery:{percent,status}\|null, load, uptime, temp, net:{rx,tx}, disk:{used,total,percent}}` |
| `open(url)` | — | open a URL or file with the default app |
| `fetch(url, {method, headers, body})` | `network` | server-side fetch (no CORS limits). Returns `{status, headers, text}` |
| `run(cmd, {timeout})` | `shell` | runs a shell command. Returns `{code, stdout, stderr}` |
| `apps()` | — | installed apps: `[{id, name, comment, categories, icon, iconUrl}]` (read-only) |
| `desktopItems()` | — | the contents of `~/Desktop`: `[{name, path, kind: 'file'\|'dir'\|'app', mime, iconUrl}]` (read-only) |
| `focus()` | — | give the widget layer keyboard focus (for example, when a game starts). It stays below other windows |

Icons: `/icon?name=<icon-name>&size=<px>` serves any icon from the current GTK icon theme.
`iconUrl` fields already point there.

## 5. Rules of thumb for widget authors

- Use `ctx.every`/`ctx.raf`/`ctx.on` instead of raw `setInterval` and `addEventListener` on
  `window`, so hot reload and removal clean up after you.
- Don't touch `document` outside your shadow root.
- Prefer CSS transforms for animation. Pause heavy work when `visibility` reports
  `false`.
- Creatures: make the home widget `look: "clear"` (or a small glass "nest"), and draw the
  creature with `ctx.overlay.create({interactive: true})` so it can wander the whole
  screen. Use `ctx.desktop.widgets()` to find platforms to stand on.

### Performance (please read)
All widgets share **one full-screen transparent surface**. Any DOM or style change on any
frame makes WebKit recomposite that whole surface and hand it to the window system. A
single always-running 60 fps animation costs about 25% CPU on its own. In practice:
- **Write to the DOM only when a value actually changed.** Even writing the same `transform`
  string again costs a repaint.
- **Stop or slow your loop when idle.** Sleeping or standing still means no per-frame writes.
  Use `ctx.raf(fn, {fps: 30})` for sprites. 30 to 40 fps looks fine.
- Avoid infinite CSS animations. If you need one, use `steps(n)` so it repaints a few times a
  second, not 60.
- Avoid `backdrop-filter` and `filter: blur()` on elements that move.

## 6. Debugging

- Developing in a normal browser: run `widgetctl url` and open the printed URL in
  Chrome/Firefox. You get the same shell and widgets, with full devtools.
- `widgetctl devtools` opens the WebKit inspector in the real desktop window.
- Log file: `~/.local/share/widgetsystem/widgetsystem.log` (contains `ctx.log` output,
  uncaught errors and mount failures). `widgetctl log -n 100` prints it and returns.
  `widgetctl log -f` follows it.
- `widgetctl snapshot out.png` renders the real widget layer to a PNG, so you can check
  visuals even when windows cover the desktop.
- `widgetctl eval '<js>'` runs JavaScript in the shell page and prints the result as JSON
  (testing without a mouse; widget content is reachable via
  `document.querySelector('[data-id=<instance>] .ws-content').shadowRoot`).
- `widgetctl add <widget-id>`, `widgetctl list`, `widgetctl reload`, `widgetctl edit`
