# dsh-plugin-zquota

中文 | [Chinese](README.zh.md)

A Zhipu GLM Coding Plan account panel plugin for DeepSeek Harness: multi-account quota monitoring + one-click account switching.

- **Quota meters**: per-account 5-hour window / weekly / monthly-MCP cells (orange ≥70%, red ≥90%), reset countdowns precise to hours above one day and to minutes below it, per-tool MCP details on hover
- **One-click switching**: "Set active" writes the chosen account's API key to `ZAI_CODING_CN_API_KEY`; `llm-pi-ai` re-resolves credentials on every model request, so **the next request uses the new key — no restart**
- **Data ownership**: accounts and API keys live in your local `$DSH_HOME/.credentials.yaml`; key material never reaches the browser
- **Query path**: the host half calls `open.bigmodel.cn` / `api.z.ai` via `ctx.shell` + curl, with keys injected through environment variables only (never command lines)
- **Styling**: built entirely on DSH design tokens (`--dsw-alias-*`); follows light/dark theme automatically

## Install

Prerequisites: DeepSeek Harness (`dsh` CLI) + `curl` on PATH.

```sh
# 1. Install into the web profile (pnpm natively supports GitHub specifiers)
dsh plugin --profile web add github:<your-user>/dsh-plugin-zquota

# 2. Mount: edit ~/.dsh/profiles/web/cordis.patch.yml and add:
#    - insert:
#        - id: zquota
#          name: dsh-plugin-zquota
#
#    (or copy install/cordis.patch.example.yml from this repo)

# 3. Refresh the browser page; if the panel does not appear, restart dsh web
```

The panel lives under **Settings → GLM Coding Plan**.

### Prerequisite for account switching

Your model route must reference the credential via `apiKeyEnv: ZAI_CODING_CN_API_KEY` in `settings.yaml`:

```yaml
llm-pi-ai:
  providers:
    zai-coding-cn:
      apiKeyEnv: ZAI_CODING_CN_API_KEY
agent-default-model:
  provider: zai-coding-cn
  model: glm-5.3
```

Quota monitoring works without this — any added account can be queried.

### Local development

```sh
git clone https://github.com/<you>/dsh-plugin-zquota
cd dsh-plugin-zquota
# Rebuild the client bundle with the DSH source repo's tsdown (lib/ is committed; usually unneeded)
/path/to/deepseek-harness/node_modules/.bin/tsdown --config tsdown.config.ts
# Install as a link: into the profile — source edits apply immediately (host half needs no build)
dsh plugin --profile web add /path/to/dsh-plugin-zquota
```

## Architecture

One npm package carries both halves (isomorphic to first-party plugins):

| Half | Entry | Responsibilities |
|---|---|---|
| Host | `src/host.js` (`exports "."`, plain ESM, zero build) | credential storage, curl quota queries, JSON API over the `webServer` prefix route `/zquota-api` |
| Client | `lib/client.js` (`exports "./client"`, closure-factory bundle) | the `settings.section` page UI, talking to `/zquota-api` via same-origin `fetch` |

The `dsh.client` declaration in `package.json` lets the web shell discover and serve the bundle (`/plugins/dsh-plugin-zquota/client.js`).
Static packages have no package-private RPC channel like dynamic plugins do; the same-origin HTTP API is the equivalent (with a custom-header + loopback-Host local defense).

## Security notes

- API keys live in `~/.dsh/.credentials.yaml` (0600) — same store and permission tier as DSH's own credentials
- The browser half never receives key material (the `state` response carries only a `live` flag)
- `/zquota-api` accepts only loopback requests carrying the `x-zquota-client` header (blocks cross-site simple requests and DNS rebinding)

## License

MIT
