# dsh-plugin-zquota

[English](README.md) | 中文

DeepSeek Harness 的智谱 GLM Coding Plan 账号面板插件：多账号额度监控 + 一键切换当前账号。

- **额度监控**：每账号三格 meter —— 5 小时窗口 / 每周 / MCP 月（≥70% 橙、≥90% 红），重置倒计时大于 1 天精确到小时、小于 1 天精确到分钟，MCP 月悬停可见分工具明细
- **一键切换**：「设为当前」把所选账号的 API Key 写入 `ZAI_CODING_CN_API_KEY`；`llm-pi-ai` 每次模型请求重新解析凭据，**下一次请求即生效，无需重启**
- **数据归属**：API Key（机密）存于本机 `$DSH_HOME/.credentials.yaml`（`ZAI_QUOTA_KEY_<id>`，与 DSH 自身凭据同库）；账号索引与额度快照（非机密状态）存于插件自有状态文件 `$DSH_HOME/zquota-state.json`（0600、原子写）。API Key 明文永不进入浏览器
- **查询通路**：Host 半用 Node 原生 fetch 直连 `open.bigmodel.cn` / `api.z.ai`（进程内 HTTPS，不经 shell/沙箱，无外部依赖），Key 仅进入内存中的请求头
- **样式**：完整使用 DSH 设计令牌（`--dsw-alias-*`），深浅色主题自动跟随

## 安装

前置：Node.js 环境（`npx` 会自动拉取 dsh，无需全局安装）。

```sh
# 一条命令安装并自动挂载（package.json 声明 dsh.bundle.patch，
# 安装后 dsh 自动把本插件加入 bundles 层）
npx @deepseek-ai/dsh plugin --profile web add github:wuyan19/dsh-plugin-zquota

# 刷新浏览器页面；若面板未出现，重启 dsh web
```

查询与卸载：

```sh
# 查询 profile 里已安装的插件（--depth 0 只列直接依赖，即手动安装的插件）
npx @deepseek-ai/dsh plugin --profile web list --depth 0

# 卸载（自动从 bundles 层一并移除，重启 dsh web 后完全生效）
npx @deepseek-ai/dsh plugin --profile web remove dsh-plugin-zquota
```

面板位置：**设置 → GLM 编程套餐**。

### 生效前提（账号切换功能）

模型路由需通过 `apiKeyEnv: ZAI_CODING_CN_API_KEY` 引用凭据，即 `settings.yaml`：

```yaml
llm-pi-ai:
  providers:
    zai-coding-cn:
      apiKeyEnv: ZAI_CODING_CN_API_KEY
agent-default-model:
  provider: zai-coding-cn
  model: glm-5.3
```

额度监控不依赖此配置，任何账号添加后即可查询。

### 本地开发

```sh
git clone https://github.com/wuyan19/dsh-plugin-zquota
cd dsh-plugin-zquota
# 用 DSH 源码仓库的 tsdown 构建 client bundle（lib/ 已随仓库提交，通常无需重建）
/path/to/deepseek-harness/node_modules/.bin/tsdown --config tsdown.config.ts
# 以 link 方式装进 profile，改代码即时生效（host 半零构建）
npx @deepseek-ai/dsh plugin --profile web add /path/to/dsh-plugin-zquota
```

## 架构

一个 npm 包携带两个半侧（与官方插件同构）：

| 半侧 | 入口 | 职责 |
|---|---|---|
| Host | `src/host.js`（`exports "."`，纯 ESM 零构建） | API Key 凭据存取、Node fetch 配额查询（不经沙箱）、状态文件维护（`$DSH_HOME/zquota-state.json`）、`webServer` 前缀路由 `/zquota-api` 提供 JSON API |
| Client | `lib/client.js`（`exports "./client"`，闭包工厂 bundle） | `settings.section` 设置页 UI，同源 `fetch` 调用 `/zquota-api` |

`package.json` 的 `dsh.client` 声明让 web 外壳发现并服务该 bundle（`/plugins/dsh-plugin-zquota/client.js`）。
静态包没有动态插件的包私有 RPC 通道，同源 HTTP API 是其等价替代（带自定义头 + loopback Host 校验的本地防线）。

## 安全说明

- 凭据文件只放真机密：每个账号的 API Key（`ZAI_QUOTA_KEY_<id>`，0600，与 DSH 自身凭据同库同权限等级）；非机密的账号索引与额度快照在插件自有状态文件 `$DSH_HOME/zquota-state.json`（0600、temp+rename 原子写）
- 浏览器半永远收不到 Key 明文（`state` 响应只含 `live` 标志）
- `/zquota-api` 仅接受携带 `x-zquota-client` 头的 loopback 请求（防跨站简单请求与 DNS rebinding）

## License

MIT
