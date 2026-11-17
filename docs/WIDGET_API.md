# Widget API (v1)

This is the contract between **WidgetSystem** (the host) and **widgets** (DeskSprite,
CyberTasks, anything else). If you need something that is not here, ask: see
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
| `ctx.frame.expand()` / `.collapse()` / `.toggleExpand()` / `.isExpanded()` | full screen and back. Only one widget is expanded at a time; it gets keyboard focus, and the host shows an "Exit full screen" pill |
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
| `key` | `{key, code, type: 'keydown'\|'keyup', repeat, inInput, ctrl, shift, alt}`, only for the **focused** widget: the one the user last clicked (its frame or one of its overlay elements), the expanded widget, or one that called `ctx.host.focus()`. `inInput` is true while the user types in an input; ignore those events for game controls |

### Keys
- `ctx.keys.capture(['Escape'])`: while your widget has focus, the host doesn't act on these keys
  (normally Esc collapses the full-screen widget, then leaves edit mode). Returns a release function.
- Esc in an open menu or dialog only closes that menu.

### Timers (auto-cancelled on unmount)
- `ctx.every(ms, fn)` returns a stop function
- `ctx.after(ms, fn)` returns a cancel function
- `ctx.raf(fn(dt, t), {fps})` starts an animation loop with `dt` in seconds and returns a stop function. `fps` caps the rate (default 60). It pauses automatically while widgets are hidden

### Theme
WidgetSystem ships theme packs in `themes/<id>/`: **Night Cron** (`night-cron`, the default: dark
maroon panels, red frames, cyan selection, yellow accents, cut corners, Rajdhani) and **Glass**
(`glass`: frosted cards that follow the system light/dark setting). Users switch in the ✦ menu
or with `widgetctl theme <id>`. Build your widget on the variables and kit parts below, and it
looks right in every theme.

- `ctx.theme` is `{name, dark}`. The `theme` event fires when either changes.
- Your shadow root's `.ws-root` (and your overlay root) carries `data-theme="<id>"`, so CSS
  can add theme touches: `.ws-root[data-theme="night-cron"] .time { … }`.
- **Variables:**

  | group | variables |
  |---|---|
  | text | `--ws-fg`, `--ws-fg-strong`, `--ws-fg-muted` |
  | colors | `--ws-primary` + `--ws-on-primary` (headers, buttons), `--ws-accent` + `--ws-on-accent` (selection, progress), `--ws-red`, `--ws-cyan`, `--ws-yellow`, `--ws-ink` (dark text on bright slabs) |
  | surfaces | `--ws-surface`, `--ws-surface-hover`, `--ws-border`, `--ws-edge`, `--ws-panel` (menus), `--ws-panel-bg` (your own panels) |
  | shape | `--ws-radius`, `--ws-radius-sm`, `--ws-cut` (chamfer size; 0 in Glass), `--ws-cut-sm`, `--ws-skew` (progress lean) |
  | effects | `--ws-glow`, `--ws-scan` (scanline background or `none`), `--ws-decor` (`display` value for decorations: `none` in Glass) |
  | fonts | `--ws-font`, `--ws-font-mono` |

- **Kit classes** (zero specificity, easy to override; themes restyle them):

  | class | what it is |
  |---|---|
  | `.ws-btn`, `.ws-btn.primary`, `.ws-input`, `.ws-check`, `.ws-muted`, `.ws-big` | basics |
  | `.ws-bar` | header strip |
  | `.ws-sel` | `<div class="ws-sel"><button>◁</button><output>…</output><button>▷</button></div>` selector |
  | `.ws-toggle` (+ `.on`) | `<button class="ws-toggle on">On<i></i></button>` switch |
  | `.ws-diamond` (+ `.on`) | check marker |
  | `.ws-tag`, `.ws-tag.accent`, `.ws-tag.warn` | small labels |
  | `.ws-seg` | segmented progress: `<div class="ws-seg"><i class="on"></i>…</div>`; segments can be `on` / `warn` / `hot` |
  | `.ws-micro` | footer line: `<div class="ws-micro"><i class="bars"></i><span class="grow"></span></div>` |
  | `.ws-banner` | celebration band |

- `ctx.ui.micro(dateKey?)` returns `{text, title}` for the daily footer line: the day of the year
  plus an "on this day in computing" fact, or a programmer saying on days without one.
  `dateKey` defaults to today.

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

### Layers, sheets, tickets & actors (API v2)
**Layers.** Overlay elements live in one of two layers:
- `back` (the default): behind an expanded widget
- `front`: above it

With no widget expanded, both look the same. When a widget expands, it becomes the **sheet**: it
covers the back layer, so creatures standing "on the desktop" are hidden behind it instead of
floating on top.

| member | |
|---|---|
| `ctx.overlay.create({layer, interactive, actor})` | `layer: 'back' \| 'front'`. Pass `actor: {role, name, kind}` to make the element visible to other widgets as a character |
| `el.setLayer('back' \| 'front')` | move an overlay element between layers, e.g. after climbing through a hole |
| `el.setActorState({state, layer})` | update what other widgets see about this actor |
| `ctx.overlay.rootFor(layer)` | the overlay root of a layer |
| `ctx.say(text, {anchor, channel, layer})` | bubbles follow the anchor's layer. Up to 3 `channel`s per widget can talk at once |
| `ctx.particles.burst({layer})` | default `'front'` |
| `ctx.desktop.sheet()` | `null` or `{id, widget, rect, tearable, protect:[rects], maxTears, tears:[ticket]}` |
| `ctx.desktop.actors()` | `[{id, instance, widget, role, name, kind, state, layer, rect}]` |
| `ctx.frame.setTearable(bool)` / `ctx.frame.protect([{x,y,w,h}])` | for widgets that expand: opt out of tears, or protect areas (content coordinates), e.g. your controls |

**Tickets** are small work orders. Any widget files them, and any widget can fix them.
- Kinds: `tear`, `crack`, `orphan`, `error`, `overdue`, `hung`, `care`.
- A `tear` is a ticket with a polygon: the host cuts it out of the sheet, so the back layer shows
  through (clicks in the hole reach the back layer too), and draws its rim. You draw any flaps
  yourself in the front layer.

| member | |
|---|---|
| `ctx.desktop.tickets.file({kind, x, y, r, sev, label, layer, ttl, points})` | returns the ticket, or `{rejected: 'disabled' \| 'busy' \| 'protected' \| 'cap'}` |
| `.update(id, {points, label, sev, busy, x, y})` | filer only. For tears, `points` grows the hole (max 4 updates/s). Set `busy: true` while something is inside the hole |
| `.claim(id)` | take the job. Released after 20 s without progress, or on unmount |
| `.progress(id, p)` | claimer only. A tear shrinks toward its center; `p = 1` resolves it |
| `.resolve(id, {x, y, exit})` | claimer or filer. The fixer's position helps the filer animate |
| `.list({kind})` | the open tickets |
| event `ticket` | `{type: 'open' \| 'update' \| 'claim' \| 'release' \| 'progress' \| 'resolve' \| 'expire' \| 'reject', ticket}` |
| event `sheet` | `sheet() \| null` whenever a widget expands or collapses |

Each tear ticket also has `ledge: {x, y, w}`, the bottom edge of the hole, a place creatures can sit.
The host files `error` tickets itself when a widget fails to mount or throws (deduped for
10 min; `target` is the broken instance id). Built-in widgets may call
`ctx.desktop.restart(instanceId)` to remount another widget.

**Tear rules (enforced by the host).** A tear is rejected:
- within 5 s of the sheet opening
- with the pointer within 160 px, or within 3 s of a keystroke
- while an input in the sheet has focus
- when it overlaps a protected zone (the top 56 px, the bottom corners, and declared rects)
- beyond the caps: 3 tears per sheet, 240×300 px and 45k px² each, 8% of the sheet in total, 48 points

Every tear expires after 90 s, and the host mends it in three steps. Hovering a hole for
1.2 s, or clicking it, makes it urgent: it heals within about 2.5 s unless someone repairs it.
Collapsing the sheet clears all tears. Users can switch tears off in the ✦ menu.

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
