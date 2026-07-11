# Development

Developer and release notes for the Basecamp Super Productivity plugin. For user-facing
docs (features, install, configure) see [README.md](./README.md).

## Build & test

```bash
npm install
npm run typecheck
npm run test      # vitest
npm run build     # esbuild -> dist/ (plugin.js, manifest.json, icon.svg, i18n/)
npm run package   # build + Node-only zip writer -> basecamp-issue-provider.zip
```

## Plugin API types (vendored)

The plugin imports only **types** from `@super-productivity/plugin-api` (the runtime
`PluginAPI` is provided by the host), so there is no runtime dependency. The type
declarations are vendored under `types/plugin-api/` and resolved via the `paths` mapping
in `tsconfig.json`.

This is because the published npm package can lag the host: the issue-provider plugin API
and newer host capabilities (`OAuthFlowConfig.redirectUri`, `PluginAPI.request`) aren't on
npm yet. Re-sync `types/plugin-api/*.d.ts` from the host's `packages/plugin-api/dist` when
the API changes; once a published version includes these types you can switch back to a
normal npm dependency.

## Packaging a release

OAuth client metadata is injected at build time and falls back to
`YOUR_BASECAMP_CLIENT_ID` / `YOUR_BASECAMP_CLIENT_SECRET` placeholders, so no secret is
committed. To bake in your app's credentials:

```bash
cp .env.example .env      # fill BASECAMP_CLIENT_ID / BASECAMP_CLIENT_SECRET
npm run package           # build + zip dist/ -> basecamp-issue-provider.zip
```

Distribute `basecamp-issue-provider.zip`. Without a `.env`, the build still produces a
working ZIP that requires each user to supply their own app credentials via the advanced
config fields.

> **Security:** Basecamp/Launchpad is OAuth-only with no PKCE, so any shipped
> `client_secret` is **effectively public**. Treat it as non-confidential and rotate it if
> leaked. The bring-your-own-app path is the secure option for security-conscious users and
> self-hosters.

## `minSupVersion`

`src/manifest.json`'s `minSupVersion` should name the first Super Productivity release that
includes the host capabilities the plugin relies on:

- **OAuth host hooks** (`OAuthFlowConfig.redirectUri` + loopback fixed-port) —
  [super-productivity#8546](https://github.com/super-productivity/super-productivity/pull/8546),
  merged.
- **`PluginAPI.request`** (needed for timesheet push) —
  [super-productivity#8721](https://github.com/super-productivity/super-productivity/pull/8721),
  merged and released in Super Productivity v18.14.0. `minSupVersion` is therefore
  `18.14.0`, so older hosts fail fast with a clear message instead of a silent runtime
  error.
