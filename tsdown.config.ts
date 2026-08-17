/**
 * dsh-plugin-zquota — client bundle 构建配置。
 *
 * 复刻 DSH 仓库 packages/client/tsdown.client.ts 中 clientConfig 的产物格式：
 * 闭包工厂 artifact —— bundle 调用 window.__ModuleLoader__.load({id, factory})
 * 并经注入的 require 解析平台 externals（loader 模块表；cordis DI 实体，
 * 无全局、无 import map）。平台模块列表与仓库 packages/client/web/src/platform.ts
 * 保持一致；新增平台模块时旧 bundle 会改为内联，仍可运行。
 *
 * 在 DSH 源码仓库内构建（复用其 node_modules 中的 tsdown）：
 *   /path/to/deepseek-harness/node_modules/.bin/tsdown --config tsdown.config.ts
 * 或在安装了 tsdown 的环境直接：pnpm run build
 */

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/** 运行时快照引擎豁免（见仓库 tsdown.client.ts 的 RUNTIME_STORE_EXEMPTION）。 */
const CLIENT_EXTERNALS = [...PLATFORM_MODULES, '@deepseek-ai/dsh-client-runtime/client']

export default {
  name: 'dsh-plugin-zquota/client',
  entry: { client: 'src/client.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...CLIENT_EXTERNALS],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  noExternal: id => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-plugin-zquota", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
