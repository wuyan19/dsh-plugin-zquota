# dsh-plugin-zquota

English | [中文](README.zh.md)

A Zhipu GLM Coding Plan account panel plugin for DeepSeek Harness: multi-account quota monitoring + one-click account switching.

- **Quota meters**: per-account 5-hour window / weekly / monthly-MCP cells (orange ≥70%, red ≥90%), reset countdowns precise to hours above one day and to minutes below it, per-tool MCP details on hover
- **One-click switching + model-route auto-provisioning (CN and intl)**: "Set active" writes the chosen account's API key to the endpoint's credential reference (CN `ZAI_CODING_CN_API_KEY` → route `zai-coding-cn`; intl `ZAI_API_KEY` → route `zai`) and auto-provisions the model settings — on a fresh install (no providers configured at all) the first click creates the whole route (API-key reference, a `glm-5.3` model entry: 1,000,000-token context / 128,000 max output; the endpoint comes from DSH's built-in catalog default — no `baseURL` is written) and points the default model at that route's `glm-5.3`; already-configured setups get only the missing pieces, never overwriting explicit values. The "Active" badge follows whichever GLM coding route the default model actually uses. `llm-pi-ai` re-resolves credentials and configuration on every model request, so **the next request just works — no restart**
- **Data ownership**: API keys (secrets) live in your local `$DSH_HOME/.credentials.yaml` (`ZAI_QUOTA_KEY_<id>`, same store as DSH's own credentials); the account index and quota snapshots (non-secret state) live in the plugin's own state file `$DSH_HOME/zquota-state.json` (0600, atomic writes). Key material never reaches the browser
- **Query path**: the host half calls `open.bigmodel.cn` / `api.z.ai` with Node's native fetch (in-process HTTPS — no shell, no sandbox, no external curl); keys live only in in-memory request headers
- **Styling**: built entirely on DSH design tokens (`--dsw-alias-*`); follows light/dark theme automatically

## Install

Prerequisites: Node.js (`npx` pulls the dsh CLI automatically; no global install).

```sh
# One command installs and auto-mounts (package.json declares dsh.bundle.patch;
# dsh adds this plugin to the bundles layer on install)
npx @deepseek-ai/dsh plugin --profile web add github:wuyan19/dsh-plugin-zquota

# Refresh the browser page; if the panel does not appear, restart dsh web
```

List and uninstall:

```sh
# List plugins installed in the profile (--depth 0 shows direct dependencies only,
# i.e. the plugins you installed yourself)
npx @deepseek-ai/dsh plugin --profile web list --depth 0

# Uninstall (also removes the bundle layer automatically; fully effective after a dsh web restart)
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-zquota
```

The panel lives under **Settings → GLM Coding Plan**.

### Model-route auto-provisioning (account switching, CN and intl)

"Set active" also checks and fills two user sections of `settings.yaml` through `ctx.settings` (hot-reloaded, no restart). The route is chosen by the account's endpoint: **CN → `zai-coding-cn` with credential reference `ZAI_CODING_CN_API_KEY`, intl → `zai` with credential reference `ZAI_API_KEY`** (separate account systems, never mixed; provisioning one route never touches the other's configuration):

- `llm-pi-ai.providers.<route>`: when the route is absent it is created whole — `apiKeyEnv: <the endpoint's credential reference>`, `models: [{ id: glm-5.3, name: GLM-5.3, contextWindow: 1000000, maxTokens: 128000 }]`. **No `baseURL` is ever written**: the route key is itself the binding into pi-ai's built-in catalog, which supplies the endpoint and protocol and tracks catalog updates; when the route already exists the same fill-only-missing rule applies (re-pointing `apiKeyEnv` to this panel's write target, appending `glm-5.3` to a curated model list, sizing a bare `glm-5.3` entry that carries only id/name — unsized entries would fall back to 262144/32768) and **explicit user configuration is never overwritten** — a custom `baseURL` (mirror gateway) and sized model entries stay as they are
- `agent-default-model`: written wholesale when the current default is not on `<route>`; **compatible with dsh-vision-router** — its auto-vision twin route `<route>-vision` (e.g. `zai-coding-cn-vision`, registered dynamically, delegating text turns to the base route and sharing its credential reference) counts as "already pointing there": the provider is kept as-is and never demoted back to the base route, only the model is aligned to `glm-5.3`

The "Active" badge follows the same routing: it reads which GLM coding route the current default model resolves to (a vision twin maps to its base route) and compares that route's credential reference — with both endpoints configured there is never more than one active badge, and when the default model targets another provider no badge lights up.

So no manual pre-configuration is needed anymore: on a fresh install (no provider configured at all), add an account (CN or intl), click once, and start talking. Quota monitoring never depended on model configuration — any added account can be queried.

### Local development

```sh
git clone https://github.com/wuyan19/dsh-plugin-zquota
cd dsh-plugin-zquota
npm install
# Rebuild the client bundle (tsdown comes from this repo's devDependencies —
# no DSH source checkout needed; lib/ is committed, rebuild only after editing src/client.js)
npm run build
# Install as a link: into the profile — host-half edits apply after a dsh web restart (no build needed)
npx @deepseek-ai/dsh plugin --profile web add /path/to/dsh-plugin-zquota
# Run the tests (happy/edge/failure coverage of planRouteProvision, the pure provisioning planner)
npm test
```

## Architecture

One npm package carries both halves (isomorphic to first-party plugins):

| Half | Entry | Responsibilities |
|---|---|---|
| Host | `src/host.js` (`exports "."`, plain ESM, zero build) | API-key credential access, Node-fetch quota queries (sandbox-free), state-file maintenance (`$DSH_HOME/zquota-state.json`), model-route auto-provisioning (`ctx.settings.mutate` path edits — fill what's missing, never overwrite), JSON API over the `webServer` prefix route `/zquota-api` |
| Client | `lib/client.js` (`exports "./client"`, closure-factory bundle) | the `settings.section` page UI, talking to `/zquota-api` via same-origin `fetch` |

The `dsh.client` declaration in `package.json` lets the web shell discover and serve the bundle (`/plugins/dsh-plugin-zquota/client.js`).
Static packages have no package-private RPC channel like dynamic plugins do; the same-origin HTTP API is the equivalent (with a custom-header + loopback-Host local defense).

## Security notes

- The credentials file holds real secrets only: one API key per account (`ZAI_QUOTA_KEY_<id>`, 0600, same permission tier as DSH's own credentials); the non-secret account index and quota snapshots live in the plugin's own state file `$DSH_HOME/zquota-state.json` (0600, atomic temp+rename writes)
- The browser half never receives key material (the `state` response carries only a `live` flag)
- `/zquota-api` accepts only loopback requests carrying the `x-zquota-client` header (blocks cross-site simple requests and DNS rebinding)

## License

MIT
