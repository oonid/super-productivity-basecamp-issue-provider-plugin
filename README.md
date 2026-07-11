# Basecamp for Super Productivity

A community [Super Productivity](https://github.com/super-productivity/super-productivity)
plugin that connects **Basecamp 3 To-dos** to Super Productivity: import to-dos from a
chosen to-do list as tasks, keep their done-state and due date in sync, and push tracked
time back to Basecamp timesheets.

> Install-from-ZIP community plugin — **not** bundled with Super Productivity, and not
> reviewed or guaranteed by the Super Productivity team.

## What it does

| Capability                                                          | Status |
| ------------------------------------------------------------------- | :----: |
| Import Basecamp **To-dos** from a chosen to-do list as SP tasks     |   ✅   |
| Two-way **done-state** sync (complete ↔ re-open)                    |   ✅   |
| Two-way **due date** sync                                           |   ✅   |
| Import **notes** — Basecamp description → SP Markdown                |   ✅   |
| OAuth connect (desktop loopback); account → project → list pickers  |   ✅   |
| Bring-your-own Basecamp OAuth app credentials                       |   ✅   |
| Push Super Productivity tracked time to Basecamp timesheets         |   ✅   |

### Field sync

| Field       | Direction        | Notes |
| ----------- | ---------------- | ----- |
| Done state  | **two-way**      | `completed` ↔ SP done |
| Due date    | **two-way**      | Basecamp `due_on` ↔ SP due day (date only) |
| Notes       | **import only**  | Basecamp description (rich-text HTML) is converted to **Markdown** on import (bold, italic, links, lists, quotes, headings; attachments become links). SP renders notes as Markdown, so formatting is preserved rather than flattened. |
| Title       | import only      | Shown as the task title |

> **Why notes are import-only:** Basecamp descriptions are rich HTML, SP notes are
> Markdown. Importing HTML→Markdown is lossless enough, but writing Markdown back to
> Basecamp would replace the original description and drop anything beyond the supported
> subset (attachments, embeds) — so notes are deliberately not pushed back. Due-date
> write-back is lossless (a date) and preserves the to-do's title.

### Timesheet push

Starting with plugin **v0.1.2**, tracked time can be posted to the linked Basecamp
to-do's timesheet entries.

The advanced **Time tracking** setting controls when time is pushed:

| Mode              | Behavior |
| ----------------- | -------- |
| On stop and done  | Push when stopping work on a linked task and when completing it (default) |
| On stop           | Push only when stopping work on a linked task |
| On done           | Push only when completing a linked task |
| Off               | Do not push tracked time to Basecamp |

The plugin posts positive time deltas by day to:

`https://3.basecampapi.com/<accountId>/recordings/<todoId>/timesheet/entries.json`

It uses Super Productivity's guarded `PluginAPI.request` bridge and declares only the
Basecamp API host in `allowedHosts`.

Timesheet behavior notes:

- Time is rounded down to Basecamp's `0.01h` granularity; smaller deltas accumulate until
  enough time is available to post.
- Watermarks are persisted so the same time is not posted twice.
- Failed pushes for inaccessible/disabled timesheets, validation errors, rate limiting, or
  transient server errors do not advance the watermark, so time can be retried later.
- Basecamp project timesheets must be available to the authenticated user.

### Scope & limitations

- **To-dos only.** Other Basecamp tools — Card Table, Message Board, Docs & Files,
  Schedule — are not imported.
- **These fields only.** Beyond the table above, other to-do fields (comments, assignees,
  etc.) are not synced.
- **Timesheets must be enabled/available in Basecamp.** If the project or account does not
  allow timesheet entries for the authenticated user, time push is skipped and reported.
- **Desktop (Electron) only** for connecting — the OAuth flow uses a loopback redirect.

## Roadmap

- [ ] Sync more to-do fields (e.g. assignee) — under consideration.
- [ ] Additional Basecamp tools (e.g. Card Table) — under consideration.

## Requirements

- Super Productivity **v18.14.0 or newer**.
- Generic plugin **OAuth host hooks**
  ([#8546](https://github.com/super-productivity/super-productivity/pull/8546), merged).
- Guarded `PluginAPI.request` with `http` permission + exact `allowedHosts`
  ([#8721](https://github.com/super-productivity/super-productivity/pull/8721), merged and
  released in v18.14.0). This is required for timesheet push.
- The **desktop (Electron)** app — the OAuth flow uses a loopback redirect.

## Install

Settings → **Plugins** → install from ZIP → choose `basecamp-issue-provider.zip`, then
enable the plugin.

## Configure

1. **Connect** — click **Connect Basecamp** and authorize in the browser (loopback
   callback on `http://127.0.0.1:8976/callback`).
2. Pick your **account → project → to-do list** (dependent dropdowns).
3. Optional: open **Advanced config → Time tracking** and choose when SP tracked time should
   be posted to Basecamp timesheets.
4. Import and sync then work like any other issue provider.

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
