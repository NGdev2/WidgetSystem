# WidgetSystem

Desktop widgets that live **on your wallpaper**, not in your window list. You get frosted-glass
cards (clock, system stats), creatures that walk across the screen and jump onto your
widgets, particles and speech bubbles. Every widget is a small HTML/CSS/JS folder.

- **Not an app you Alt-Tab to.** One transparent window, pinned below all apps and hidden from
  Alt-Tab, the taskbar, the dock and the Activities overview.
- **Click-through.** Only the widgets take mouse input. Clicks anywhere else reach the desktop.
- **Glass like macOS.** The wallpaper behind each widget is sampled and blurred, so this works
  on GNOME/X11 without compositor blur.
- **Expand to full screen** and back. It stays on the desktop layer and works the same.
- **Styling per instance**: glass / tint / solid / clear, title on or off, border, radius, padding, tint color.
- **Edit mode**: drag, resize, remove, and a gallery to add widgets.
- **Hot reload** when you save a widget file. Settings dialogs are generated from the manifest.
  Storage persists to disk.
- **Desktop-wide effects**: free-roaming overlay elements, speech bubbles, a particle system,
  global pointer, messages between widgets.

## Run

```bash
python3 -m widgetsystem           # from this folder
bin/widgetctl start               # or: start detached
./install.sh                      # optional: widgetctl in ~/.local/bin + start at login
```

Requirements: Python 3.10+, PyGObject, GTK 3, WebKit2GTK 4.1 (preinstalled on Ubuntu 22.04+).
No pip packages.

Use it: hover a widget for controls, **right-click** for its menu, use the **✦** button in the
bottom-right corner (add, edit, hide), and **Ctrl+drag** to move any widget. Esc leaves edit
mode or full screen.

```
widgetctl list | add <widget> | remove <id> | send <target> <json> | edit | gallery
widgetctl toggle | reload | devtools | snapshot out.png | url | log | path add <dir> | quit
```

## Writing widgets

See **[docs/WIDGET_API.md](docs/WIDGET_API.md)**. Minimal widget:

```
~/.local/share/widgetsystem/widgets/hello/widget.json   {"id":"hello","name":"Hello","size":{"w":200,"h":100}}
~/.local/share/widgetsystem/widgets/hello/main.js       export function mount(ctx){ ctx.root.textContent = 'Hello!' }
```

Built-in examples in `widgets/`: `clock` (digital/analog), `sysmon` (CPU/RAM/battery/network),
and `pet` (Mochi, a Tamagotchi-style creature that roams and jumps between widgets).
For tasks, see [CyberTasks](https://github.com/NGdev2/CyberTasks).

Several Claude sessions build widgets against this API. See [docs/COMMS.md](docs/COMMS.md).

## Architecture

```
┌─────────────── python3 -m widgetsystem ────────────────┐
│ server.py   HTTP on 127.0.0.1:47800                    │
│   /shell/*      web runtime (runtime.js, ui, glass…)   │
│   /w/<id>/<v>/  widget files (versioned => hot reload) │
│   /api/*        JSON API (token): storage, stats, …    │
│   /events       SSE: theme, hot reload, commands       │
│ registry.py  widget discovery + change polling         │
│ desktop.py   apps, ~/Desktop items, icon theme lookup  │
│ host_gtk.py  transparent X11 window, below all apps,   │
│              skip-taskbar, XShape input region,        │
│              global pointer, snapshots                 │
└────────────────────────────────────────────────────────┘
       ▲ WebKitGTK loads the shell; widgets are ES modules in shadow roots
```

The web runtime knows nothing about the platform: it talks to the core over HTTP. The same
shell runs in a normal browser (`widgetctl url`) for development. Porting to another
platform only means writing a new `host_*.py`, or a Tauri/Electron shell, that shows a
transparent click-through window and loads that URL.

## Why build this? (state of the art, Oct 2026)

| Existing option | Why it didn't fit |
|---|---|
| **Conky** | text and graphics drawn in Lua. No real UI, interactivity or modern styling |
| **KDE Plasma widgets** | excellent, but only inside KDE Plasma (QML) |
| **GNOME Shell extensions / Cinnamon desklets** | tied to one desktop, GJS, break between shell versions |
| **Eww, AGS/Astal, Quickshell, Fabric** | powerful, but built around the Wayland layer-shell protocol (Hyprland/Sway/KDE). Not supported by GNOME/Mutter. Aimed at status bars, not living widgets |
| **gDesklets, Screenlets** | dead for over 10 years |
| **Übersicht (macOS), Rainmeter (Windows)** | the closest in spirit, but they don't run on Linux |

None of them offered web-level styling, glass, expand-to-full-screen, and creatures roaming
the desktop together, on GNOME, with a simple API for other projects.

## Platform notes and roadmap

- **Now:** GNOME/X11 (also any X11 window manager with a compositor).
- **Wayland, wlroots/KDE/Hyprland:** a `host_layershell.py` using `gtk-layer-shell` (BOTTOM layer, input region).
- **Wayland, GNOME:** Mutter has no layer-shell. Needs a tiny GNOME Shell extension that
  places the window in the background group.
- **macOS / Windows:** a Tauri shell that loads the same URL (transparent, click-through window
  at desktop level). The Python core runs everywhere.
- With a live video wallpaper (Hidamari), the glass shows the blurred *static frame* GNOME
  reports as the wallpaper.
