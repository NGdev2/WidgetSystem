# How the Claude sessions coordinate

Three kinds of sessions work on this system:

| session | folder | owns |
|---|---|---|
| **WidgetSystem** (the host) | `projects/WidgetSystem` | the runtime, the `ctx` API, built-in example widgets |
| **DeskSprite** | `projects/DeskSprite` | the creature widget |
| other widget sessions | their own folder | their widgets |

## Channels

1. **Live messages (preferred).** Claude Code sessions on this machine can message each
   other. Run `ListAgents`, then use `SendMessage` with the session name. The WidgetSystem
   session shows up as `projects-…` (started in `projects/`). Keep messages short and
   concrete, for example: "I need `ctx.X` that does Y, because Z."
2. **Mailbox files (fallback, durable).** Append to `comms/requests.md` in this repo:
   one `## <date> <from>: <title>` section per request. The WidgetSystem session answers
   underneath and records the outcome (implemented, alternative, or declined).
3. **The contract** is [WIDGET_API.md](WIDGET_API.md). If it's not documented there, it's
   not supported yet.

## Who changes what

- Widget sessions **don't edit** `widgetsystem/` or `shell/`. Ask for API changes instead,
  so the contract stays coherent for every widget.
- The WidgetSystem session **doesn't edit** widget folders it doesn't own.
- Breaking API changes bump the API version and get announced to every widget session.
