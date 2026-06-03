#!/usr/bin/env node
// 把 scripts/resolve.template.html 替换 __API_BASE__ 占位 → public/resolve/index.html
// 在 npm run build 之前自动跑（package.json 的 prebuild 钩子）。
//
// API_BASE 优先级与 src/lib/apiBase.ts 一致：
//   VITE_API_BASE_URL > 默认生产
//
// GitHub Actions 部署时 workflow 已根据分支注入 VITE_API_BASE_URL：
//   - main 分支 → https://api.ai-maimai.com/api/v1
//   - staging 分支 → https://test-api.ai-maimai.com/api/v1
//
// ⚠️ 本地手工 npm run build 时如果不设 VITE_API_BASE_URL，会落到生产 URL。
//    本地预览请显式带上：
//      VITE_API_BASE_URL=https://test-api.ai-maimai.com/api/v1 npm run build
//    否则 dist/resolve/index.html 会指向 prod 后端，与 staging 测试环境不一致。
//
// XSS 防护：apiBase 会被 inline 进 HTML 的 JS 字符串字面量（单引号包裹）。
// 黑名单含 `'` `"` `<` `>` `\` `\n` `\r` `` ` `` 等。**不**禁 `$`，因为：
//   - 用单引号字符串字面量，不是 template literal，`$` 无特殊含义
//   - String.replace 第二参数是字符串而非函数时，仅 `$&`/`$1`-`$9`/`$``/`$'` 才有特殊含义；
//     URL 不会含 `$&` 之类，且 apiBase 已强制 `^https?://[^\s]+$` 形态
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolvePath(__dirname, '..')

const apiBase = (process.env.VITE_API_BASE_URL || '').trim() || 'https://api.ai-maimai.com/api/v1'

const templatePath = resolvePath(projectRoot, 'scripts/resolve.template.html')
const outDir = resolvePath(projectRoot, 'public/resolve')
const outPath = resolvePath(outDir, 'index.html')

const template = readFileSync(templatePath, 'utf-8')

// 防呆校验
if (!template.includes('__API_BASE__')) {
  console.error('build-resolve: 模板缺少 __API_BASE__ 占位')
  process.exit(1)
}
// 防 XSS：apiBase 会被 inline 进 HTML 的 JS 字符串字面量，必须排除任何能跳出字面量的字符
const FORBIDDEN_CHARS = ["'", '"', '\n', '\r', '<', '>', '\\', '`']
const found = FORBIDDEN_CHARS.find((c) => apiBase.includes(c))
if (found) {
  console.error(
    `build-resolve: VITE_API_BASE_URL 含非法字符 ${JSON.stringify(found)}（会破坏 inline JS 字符串字面量） (got: ${JSON.stringify(apiBase)})`,
  )
  process.exit(1)
}
if (!/^https?:\/\/[^\s]+$/.test(apiBase)) {
  console.error(
    `build-resolve: VITE_API_BASE_URL 必须形如 http(s)://host[:port]/path，不含空白 (got: ${JSON.stringify(apiBase)})`,
  )
  process.exit(1)
}

const output = template.replace(/__API_BASE__/g, apiBase)

mkdirSync(outDir, { recursive: true })
writeFileSync(outPath, output, 'utf-8')

console.log(`✓ 已生成 ${outPath}`)
console.log(`  API_BASE = ${apiBase}`)
