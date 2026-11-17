# Navigator

The Navigator is WidgetSystem's widget browser, like an editor's extensions view. It lists the
widgets you have and the ones in the public index, and installs, updates and removes them.

Open it from the **✦** menu (**Navigator…**) or with `widgetctl navigator`.

- **Installed** lists every widget WidgetSystem found: built-ins, your installs, and dev folders.
- **Browse** lists the public index. Widgets that aren't public yet show as *Coming soon*.
- Select a card to see its details: description, variants, permissions, repository and local
  path. **Add to desktop** has one button per variant (for example *Daily Jobs* and *Weekly Schedule*).
- **↻** reloads the index and checks your git installs for updates.

From a terminal:

```
widgetctl browse [--refresh]     the index with installed state
widgetctl install <id> [--yes]   clone into ~/.local/share/widgetsystem/widgets/<id>
widgetctl update <id>            fast-forward a git install
widgetctl uninstall <id>         delete an install, or unregister a dev folder
widgetctl navigator              open the panel
```

## Where widgets come from

| source | where | update | remove |
|---|---|---|---|
| Built-in | `WidgetSystem/widgets/` | updates with WidgetSystem | not possible |
| Installed | `~/.local/share/widgetsystem/widgets/<id>` (`$XDG_DATA_HOME` is honored) | `git pull --ff-only` if it is a git clone | deletes the folder. A symlink there is only unlinked |
| Dev folder | a path registered with `widgetctl path add` | you manage it | unregisters the path. Nothing is deleted |

Removing a widget closes its instances on the desktop. Its shared data
(`storage/w-<id>.json`) stays, so a reinstall picks up where you left off.

## The index

The index is `registry/index.json` in this repository:

```json
{
  "version": 1,
  "widgets": [
    {
      "id": "cybertasks",
      "name": "CyberTasks",
      "description": "Daily and weekly jobs with routines, in Night City style.",
      "repo": "https://github.com/NGdev2/CyberTasks",
      "author": "NGdev2",
      "icon": "https://raw.githubusercontent.com/NGdev2/CyberTasks/main/assets/icon.svg",
      "tags": ["productivity", "tasks"],
      "permissions": [],
      "variants": ["day", "week"]
    }
  ]
}
```

| field | |
|---|---|
| `id` | must equal the `id` in the repo's `widget.json` (`[a-z0-9-]`) |
| `repo` | `https://github.com/<owner>/<repo>`, nothing else (no `.git`, no branch, no other hosts) |
| `icon` | an emoji, or an `https://` image URL (shown before the widget is installed) |
| `permissions` | must list every permission the widget's `widget.json` asks for |
| `variants` | variant ids, for display before install |
| `private` | optional. `true` shows the entry as *Coming soon*, and it can't be installed |

The running WidgetSystem reads the index from
`https://raw.githubusercontent.com/NGdev2/WidgetSystem/main/registry/index.json` and caches it for
an hour in `~/.local/share/widgetsystem/navigator-index.json`. When GitHub can't be reached it uses
the cache. Without a cache it uses the `registry/index.json` in your checkout. The footer of the
panel tells you which copy you're seeing.

## Publishing a widget

1. Put your widget in a **public GitHub repository** with `widget.json` at the root (see
   [WIDGET_API.md](WIDGET_API.md)). Users get your default branch.
2. Open a pull request on WidgetSystem that adds an entry to `registry/index.json`. Use the same
   `id` as your `widget.json`, and list the same `permissions`.
3. Once it is merged, it appears in everyone's Navigator within an hour (or right away with ↻).

Updates need no new pull request: users get your default branch with **Update**. If an update
adds the `shell` or `network` permission, the user has to accept it, and the index entry must list
it first.

## Security

- The panel and `widgetctl` only send a widget **id**. The git URL always comes from the index,
  and only `https://github.com/<owner>/<repo>` URLs are accepted.
- `git` runs directly (no shell), with a timeout and without credential prompts:
  `git clone --depth 1 --no-tags -- <repo> <tmp>`. The clone goes into a hidden folder first and
  is moved into place only after its `widget.json` passes the checks. Otherwise it is deleted.
- **Nothing from a cloned repository is executed by the installer.** No install scripts, no
  hooks, no npm. A widget's code only runs later, inside the shell page, like every other widget.
- A widget whose `widget.json` asks for permissions its index entry doesn't declare is refused.
  `shell` and `network` need an explicit confirmation that names them, in the panel, at the
  `[y/N]` prompt, or with `--yes`. The server enforces this too.
- **Update** checks the new `widget.json` before merging (`git fetch`, then `git merge --ff-only`,
  which is the same as `git pull --ff-only`). That way, a new dangerous permission is caught before
  hot reload would load the code. It only touches installs whose `origin` is a GitHub https URL.
- **Remove** only deletes folders that resolve to a path inside the user widgets folder.
  Built-ins are never touched. Dev folders are only unregistered.
- Widgets aren't sandboxed from each other or from the page. Only install widgets whose
  authors you trust, as with editor extensions.

## Server API

`POST /api/nav.<op>` (token-protected), or `ctl.nav.<op>` from widgetctl. Errors come back as
`{ok: false, error}` with a readable message.

| op | params | returns |
|---|---|---|
| `index` | `{refresh?, checkUpdates?}` | `{widgets: [...], source: remote\|cache\|local, fetchedAt, error, userWidgets}`. Each widget is its index entry plus `installed`, `source` (`builtin`\|`user`\|`dev`), `version`, `path`, `updatable`, `updateAvailable`, `inIndex`, `linked`, `devPath`, `localIcon`, `manifestPermissions`, `variantInfo`. Installed widgets that aren't in the index appear with `inIndex: false` |
| `install` | `{id, acceptPermissions?}` | the merged widget entry |
| `update` | `{id, acceptPermissions?}` | `{updated, from, to, widget}` |
| `remove` | `{id}` | `{removed: [ids], kind: deleted\|unlinked\|unregistered, path}` |

Events: `widgets` after every change, `widget-changed` after an update, and `widget-removed`
`{id}` for each widget that was uninstalled. The shell closes that widget's instances.
