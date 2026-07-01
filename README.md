# Basecamp Issue Provider — Super Productivity plugin

A community [Super Productivity](https://github.com/super-productivity/super-productivity)
plugin that connects to **Basecamp 3 To-dos**: import to-dos from a chosen to-do
list as tasks, and two-way sync done-state.

Installed from a ZIP (Settings → Plugins → install). It is **not** bundled with
Super Productivity.

## Requirements

- A Super Productivity build that includes the generic plugin OAuth host hooks
  (`OAuthFlowConfig.redirectUri` + loopback fixed-port support). These are
  proposed upstream in
  [super-productivity#8546](https://github.com/super-productivity/super-productivity/pull/8546);
  set `minSupVersion` in `src/manifest.json` to the first release that includes
  them before publishing.
- The desktop (Electron) app — the OAuth flow uses a loopback redirect.

## Why a plugin (and not built-in)

Basecamp 3 is OAuth-only (no personal access tokens) and 37signals Launchpad has
no PKCE, so the flow needs a `client_id` + `client_secret`. Rather than ship a
secret in Super Productivity core, this lives as a community plugin: it can carry
*its own* OAuth app credentials, and users can supply their own (see below).

## Configure

1. Connect — click **Connect Basecamp**; authorize in the browser (loopback
   callback on `http://127.0.0.1:8976/callback`).
2. Pick your account, then project, then to-do list (dependent dropdowns).
3. Import + two-way done-sync work like any other issue provider.

### Bring your own OAuth app (advanced, recommended for self-hosters)

Register an app at <https://launchpad.37signals.com/integrations> (redirect URI
`http://127.0.0.1:8976/callback`) and paste its `clientId` / `clientSecret`
(and `redirectUri` if different) into the plugin's **advanced** config fields.
This authenticates against your own Basecamp app instead of the shipped one.

## Develop

```bash
npm install
npm run typecheck
npm run test      # vitest
npm run build     # esbuild -> dist/ (plugin.js, manifest.json, icon.svg, i18n/)
```

### Plugin API types (vendored)

The plugin only imports **types** from `@super-productivity/plugin-api` (the
runtime `PluginAPI` is provided by the host), so there is no runtime dependency.
The type declarations are vendored under `types/plugin-api/` and resolved via the
`paths` mapping in `tsconfig.json`. This is because the published npm package can
lag the host: the issue-provider plugin API and `OAuthFlowConfig.redirectUri`
aren't in npm yet. Re-sync `types/plugin-api/*.d.ts` from the host's
`packages/plugin-api/dist` when the API changes; once a published version
includes these types you can switch back to a normal npm dependency.

## Building a release

OAuth client metadata is injected at build time and falls back to
`YOUR_BASECAMP_CLIENT_ID` / `YOUR_BASECAMP_CLIENT_SECRET` placeholders, so no
secret is committed. To bake in your app's credentials:

```bash
cp .env.example .env      # fill BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET
npm run package           # build + zip dist/ -> basecamp-issue-provider.zip
```

Distribute `basecamp-issue-provider.zip`. Without a `.env`, the build still
produces a working ZIP that requires each user to supply their own app
credentials via the advanced fields.

> Security: the shipped secret is **effectively public** (no PKCE on Launchpad).
> Treat it as non-confidential and rotate it if leaked. The bring-your-own-app
> path is the secure option for security-conscious users and self-hosters.

## License

MIT
