# Basecamp for Super Productivity

A community [Super Productivity](https://github.com/super-productivity/super-productivity)
plugin that connects **Basecamp 3 To-dos** to Super Productivity: import to-dos from a
chosen to-do list as tasks and keep their done-state in sync.

> Install-from-ZIP community plugin — **not** bundled with Super Productivity, and not
> reviewed or guaranteed by the Super Productivity team.

## What it does (v0.1.0)

| Capability                                                          | Status |
| ------------------------------------------------------------------- | :----: |
| Import Basecamp **To-dos** from a chosen to-do list as SP tasks     |   ✅   |
| Two-way **done-state** sync (complete ↔ re-open)                    |   ✅   |
| OAuth connect (desktop loopback); account → project → list pickers  |   ✅   |
| Bring-your-own Basecamp OAuth app credentials                       |   ✅   |

### Scope & limitations

- **To-dos only.** Other Basecamp tools — Card Table, Message Board, Docs & Files,
  Schedule — are not imported.
- **Status only.** Only the done/undone state syncs. Comments, assignees, due dates,
  descriptions and other to-do fields are not synced.
- **No timesheet push yet.** Time tracked in Super Productivity is not written back to the
  Basecamp to-do's timesheet. (Built, but waiting on a host capability — see Roadmap.)
- **Desktop (Electron) only** for connecting — the OAuth flow uses a loopback redirect.

## Roadmap

- [ ] **Timesheet push** — write Super Productivity time-tracking back to the Basecamp
      to-do's timesheet. Implemented in the plugin already; blocked on the `PluginAPI.request`
      host capability ([super-productivity#8721](https://github.com/super-productivity/super-productivity/pull/8721))
      and ships once that lands in a released Super Productivity.
- [ ] Sync more to-do fields (assignee, due date) — under consideration.
- [ ] Additional Basecamp tools (e.g. Card Table) — under consideration.

## Requirements

- A Super Productivity version with the generic plugin **OAuth host hooks**
  ([#8546](https://github.com/super-productivity/super-productivity/pull/8546), merged).
- The **desktop (Electron)** app — the OAuth flow uses a loopback redirect.

## Install

Settings → **Plugins** → install from ZIP → choose `basecamp-issue-provider.zip`, then
enable the plugin.

## Configure

1. **Connect** — click **Connect Basecamp** and authorize in the browser (loopback
   callback on `http://127.0.0.1:8976/callback`).
2. Pick your **account → project → to-do list** (dependent dropdowns).
3. Import and two-way done-sync then work like any other issue provider.

### Bring your own OAuth app (recommended for self-hosters)

Register an app at <https://launchpad.37signals.com/integrations> (redirect URI
`http://127.0.0.1:8976/callback`) and paste its `clientId` / `clientSecret` (and
`redirectUri` if different) into the plugin's **advanced** config fields. This
authenticates against your own Basecamp app instead of the shipped one, and your secret
stays on your machine.

## Why a plugin (and not built-in)

Basecamp 3 is OAuth-only (no personal access tokens) and 37signals Launchpad has no PKCE,
so the flow needs a `client_id` + `client_secret`. Rather than ship a secret in Super
Productivity core, Basecamp lives as a community plugin that can carry its own OAuth app
credentials (or use yours). Background:
[super-productivity#8465](https://github.com/super-productivity/super-productivity/issues/8465).

## Development

Building, testing, the vendored plugin-api types, and packaging a release are documented in
[DEVELOPMENT.md](./DEVELOPMENT.md).

## License

[MIT](./LICENSE)
