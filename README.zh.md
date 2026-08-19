# dsh-plugin-zquota

[English](README.md) | 中文

DeepSeek Harness 的智谱 GLM Coding Plan 账号面板插件：多账号额度监控 + 一键切换当前账号。

- **额度监控**：每账号三格 meter —— 5 小时窗口 / 每周 / MCP 月（≥70% 橙、≥90% 红），重置倒计时大于 1 天精确到小时、小于 1 天精确到分钟，MCP 月悬停可见分工具明细
- **一键切换 + 模型路由自动补齐（国内版/国际版通用）**：「设为当前」把所选账号的 API Key 写入对应端点的凭据引用（国内版 `ZAI_CODING_CN_API_KEY` → 路由 `zai-coding-cn`；国际版 `ZAI_API_KEY` → 路由 `zai`），同时自动补齐模型配置——全新安装（什么供应商都没配）首次点击即创建整条路由（API Key 引用、`glm-5.3` 模型项：上下文 1,000,000 / 最大输出 128,000；端点用 DSH 内置目录默认，不写 `baseURL`）并把默认模型切到该路由的 `glm-5.3`；已配置的用户只补缺失项、不覆盖显式配置。「使用中」徽章跟随当前默认模型路由实际在用的账号。`llm-pi-ai` 每次模型请求重新解析凭据与配置，**下一次请求即生效，无需重启**
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

### 模型路由自动补齐（账号切换功能，国内版/国际版通用）

「设为当前」在写入 API Key 的同时，经 `ctx.settings` 检查并补齐 `settings.yaml` 中的两处用户配置（热加载，无需重启）。按账号端点选择路由：**国内版 → `zai-coding-cn` / 凭据引用 `ZAI_CODING_CN_API_KEY`，国际版 → `zai` / 凭据引用 `ZAI_API_KEY`**（两套账号体系，互不混用；补齐其中一条不会触碰另一条的配置）：

- `llm-pi-ai.providers.<route>`：路由不存在时整条创建——`apiKeyEnv: <对应凭据引用>`、`models: [{ id: glm-5.3, name: GLM-5.3, contextWindow: 1000000, maxTokens: 128000 }]`。**不写 `baseURL`**：路由键就是 pi-ai 内置目录的绑定，端点/协议由目录默认提供、目录更新后自动跟进；路由已存在时同样只补缺失项（`apiKeyEnv` 改指本面板写点、被裁剪过的模型列表追加 `glm-5.3`、为只有 id/name 的裸 `glm-5.3` 条目补全尺寸——不补会落到路由兜底 262144/32768），**不覆盖**用户显式配置——自定义 `baseURL`（镜像网关）与已声明尺寸的模型条目原样保留
- `agent-default-model`：当前默认模型未指向 `<route>` 时整节写入；**与 dsh-vision-router 兼容**——其自动识图孪生路由 `<route>-vision`（如 `zai-coding-cn-vision`，动态注册、文字轮委托本体、共用同一凭据引用）视为「已指向」：provider 原样保留、不会被降级回本体，只把 model 对齐 `glm-5.3`

「使用中」徽章的判定也随路由走：读当前默认模型路由落在哪条 GLM 编程路由上（识图孪生按其本体归属），就比对那条路由的凭据引用——双端点并存不会出现两个徽章，默认模型指向其他供应商时徽章不亮。

因此不再需要手工预配置：全新安装（什么供应商都没配）也能添加账号（国内版或国际版）后一键应用并直接开始对话。额度监控不依赖模型配置，任何账号添加后即可查询。

### 本地开发

```sh
git clone https://github.com/wuyan19/dsh-plugin-zquota
cd dsh-plugin-zquota
npm install
# 重建 client bundle（tsdown 来自本仓库 devDependencies，无需 DSH 源码仓库；
# lib/ 已随仓库提交，只有改 src/client.js 后才需要）
npm run build
# 以 link 方式装进 profile，改 host 代码重启 dsh web 即生效（host 半零构建）
npx @deepseek-ai/dsh plugin --profile web add /path/to/dsh-plugin-zquota
# 运行测试（路由补齐纯函数 planRouteProvision 的 正常/边界/失败 三态覆盖）
npm test
```

## 架构

一个 npm 包携带两个半侧（与官方插件同构）：

| 半侧 | 入口 | 职责 |
|---|---|---|
| Host | `src/host.js`（`exports "."`，纯 ESM 零构建） | API Key 凭据存取、Node fetch 配额查询（不经沙箱）、状态文件维护（`$DSH_HOME/zquota-state.json`）、模型路由自动补齐（`ctx.settings.mutate` 路径编辑，只补缺失不覆盖）、`webServer` 前缀路由 `/zquota-api` 提供 JSON API |
| Client | `lib/client.js`（`exports "./client"`，闭包工厂 bundle） | `settings.section` 设置页 UI，同源 `fetch` 调用 `/zquota-api` |

`package.json` 的 `dsh.client` 声明让 web 外壳发现并服务该 bundle（`/plugins/dsh-plugin-zquota/client.js`）。
静态包没有动态插件的包私有 RPC 通道，同源 HTTP API 是其等价替代（带自定义头 + loopback Host 校验的本地防线）。

## 安全说明

- 凭据文件只放真机密：每个账号的 API Key（`ZAI_QUOTA_KEY_<id>`，0600，与 DSH 自身凭据同库同权限等级）；非机密的账号索引与额度快照在插件自有状态文件 `$DSH_HOME/zquota-state.json`（0600、temp+rename 原子写）
- 浏览器半永远收不到 Key 明文（`state` 响应只含 `live` 标志）
- `/zquota-api` 仅接受携带 `x-zquota-client` 头的 loopback 请求（防跨站简单请求与 DNS rebinding）

## License

MIT
