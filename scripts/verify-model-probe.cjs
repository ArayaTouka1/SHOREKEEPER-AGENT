/**
 * 模型连接探测验证（静默，mock 服务）
 *
 * 背景：Kimi 等服务的 /models 列表不完整，模型实际可调用却不在列表里。
 * 旧实现直接判「模型 ID 不在列表中」→ 误报连不上。
 *
 * 覆盖：
 *   1. 列表不含该模型、但 chat/completions 可用 → 判成功（核心修复）
 *   2. 鉴权失败（401）→ 明确报 API Key 问题，不误导为「模型不存在」
 *   3. 额度不足（402）→ 明确提示
 *   4. 模型真的不存在（404）→ 报模型/端点问题
 *   5. 限流（429）→ 视为可用（key 与模型都对）
 *   6. 无 model 参数时用 /models 判可达
 *
 * 用法：node scripts/verify-model-probe.cjs
 */
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-probe')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const PROFILE_ROOT = join(ROOT, '.verification')
mkdirSync(PROFILE_ROOT, { recursive: true })
const PROFILE = mkdtempSync(join(PROFILE_ROOT, 'sk-probe-'))
writeFileSync(
  join(PROFILE, 'stub.cjs'),
  `module.exports = {
  app: { getPath: () => ${JSON.stringify(slash(PROFILE))}, getAppPath: () => ${JSON.stringify(slash(ROOT))}, isPackaged: false, getVersion: () => '0.21.0' },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} }, nativeImage: { createFromDataURL: () => ({}) },
  Tray: class {}, Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } }
}`,
  'utf-8'
)

// 同时导出模型仓库与路由，验证切换后真实使用的端点、模型和密钥。
writeFileSync(
  join(OUT, 'entry.ts'),
  `export { probeEndpoint, modelRepo, BUILTIN_API_MODELS } from '${slash(join(ROOT, 'src/main/models'))}'\nexport { modelRoute } from '${slash(join(ROOT, 'src/main/modelRouting'))}'\nexport { settingsRepo } from '${slash(join(ROOT, 'src/main/settings'))}'\n`,
  'utf-8'
)

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'), join(OUT, 'entry.ts'),
    '--bundle', '--platform=node', '--format=cjs', '--target=node20',
    '--alias:electron=' + slash(join(PROFILE, 'stub.cjs')),
    '--outfile=' + slash(join(OUT, 'bundle.cjs')), '--log-level=warning'
  ],
  { stdio: 'inherit', cwd: ROOT }
)

const { probeEndpoint, modelRepo, modelRoute, settingsRepo, BUILTIN_API_MODELS } = require(join(OUT, 'bundle.cjs'))

/* ---------------- mock 服务 ---------------- */
const PORT = 36620
/** 场景开关 */
let scenario = 'ok'
let lastChatRequest = null
const server = http.createServer(async (req, res) => {
  // base 是 /v1，所以实际路径是 /v1/models、/v1/chat/completions
  if (req.url.includes('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    // 列表故意不含 kimi-k2-0905-preview（模拟 Kimi 的真实情况）
    res.end(JSON.stringify({ data: [{ id: 'moonshot-v1-8k' }, { id: 'some-other-model' }] }))
    return
  }
  if (req.url.includes('/chat/completions')) {
    let raw = ''
    for await (const chunk of req) raw += chunk
    lastChatRequest = {
      authorization: req.headers.authorization,
      body: raw ? JSON.parse(raw) : {}
    }
    if (scenario === 'ok' || scenario === 'ratelimit') {
      if (scenario === 'ratelimit') {
        res.writeHead(429, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'rate limited' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'pong' } }] }))
      return
    }
    const code = scenario === 'auth' ? 401 : scenario === 'quota' ? 402 : 404
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'mock ' + scenario } }))
    return
  }
  res.writeHead(404); res.end()
})

let pass = 0
let fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('  OK   ' + n) } else { fail++; console.log('  FAIL ' + n + (e ? '  -> ' + e : '')) } }

;(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + PORT + '/v1'

  console.log('=== 1. 列表不含该模型，但实际可调用（核心修复） ===')
  scenario = 'ok'
  const r1 = await probeEndpoint(base, 'sk-test', 8000, 'kimi-k2-0905-preview')
  check('判为可用（不再误报「不在列表中」）', r1.ok === true, JSON.stringify(r1.message))
  check('提示语说明模型可调用', /可调用/.test(r1.message), r1.message)
  check('仍带回服务列表供展示', Array.isArray(r1.models) && r1.models.length === 2, JSON.stringify(r1.models))

  console.log('=== 2. 鉴权失败（401） ===')
  scenario = 'auth'
  const r2 = await probeEndpoint(base, 'sk-bad', 8000, 'kimi-k2-0905-preview')
  check('判为失败', r2.ok === false)
  check('明确提示 API Key 问题（不误导为模型不存在）', /API Key/.test(r2.message), r2.message)

  console.log('=== 3. 额度不足（402） ===')
  scenario = 'quota'
  const r3 = await probeEndpoint(base, 'sk-test', 8000, 'kimi-k2-0905-preview')
  check('判为失败并提示额度', r3.ok === false && /额度/.test(r3.message), r3.message)

  console.log('=== 4. 模型/端点不存在（404） ===')
  scenario = 'notfound'
  const r4 = await probeEndpoint(base, 'sk-test', 8000, 'no-such-model')
  check('判为失败并提示模型或端点问题', r4.ok === false && /404/.test(r4.message), r4.message)

  console.log('=== 5. 限流（429）视为可用 ===')
  scenario = 'ratelimit'
  const r5 = await probeEndpoint(base, 'sk-test', 8000, 'kimi-k2-0905-preview')
  check('判为可用（key 与模型都对，只是被限流）', r5.ok === true && /限流/.test(r5.message), r5.message)

  console.log('=== 6. 不给 model 时用 /models 判可达 ===')
  scenario = 'ok'
  const r6 = await probeEndpoint(base, 'sk-test', 8000)
  check('服务可达', r6.ok === true, r6.message)

  console.log('=== 7. 内置厂商切换与密钥隔离 ===')
  const kimi = BUILTIN_API_MODELS.find((m) => m.id === 'api_kimi_k2')
  const kimi3 = BUILTIN_API_MODELS.find((m) => m.id === 'api_kimi_k3')
  const deepseek = BUILTIN_API_MODELS.find((m) => m.provider === 'deepseek')
  check('Kimi K2.6 使用当前模型 ID', kimi?.model === 'kimi-k2.6', kimi?.model)
  check('内置 Kimi K3', kimi3?.model === 'kimi-k3', kimi3?.model)
  modelRepo.updateModel(kimi.id, { baseUrl: base, apiKey: 'sk-moonshot-provider' })
  modelRepo.setActive(kimi.id)
  const kimiRoute = modelRoute(modelRepo.active(), settingsRepo.get())
  check('切换 Kimi 后路由使用 Kimi 模型', kimiRoute.model === 'kimi-k2.6', JSON.stringify(kimiRoute))
  check('切换 Kimi 后携带 Moonshot Key', kimiRoute.apiKey === 'sk-moonshot-provider')
  scenario = 'ok'
  await probeEndpoint(kimiRoute.baseUrl, kimiRoute.apiKey, 8000, kimiRoute.model)
  check('真实请求使用切换后的模型 ID', lastChatRequest?.body?.model === 'kimi-k2.6', JSON.stringify(lastChatRequest))
  check('真实请求使用切换后的 Authorization', lastChatRequest?.authorization === 'Bearer sk-moonshot-provider', JSON.stringify(lastChatRequest))
  const sibling = modelRepo.list().find((m) => m.id === 'api_kimi_k3')
  check('同厂商 Kimi 模型共享 Key', sibling?.apiKey === 'sk-moonshot-provider')
  const other = modelRepo.list().find((m) => m.id === deepseek.id)
  check('Moonshot Key 不泄露给其他厂商', !other?.apiKey)

  console.log('=== 8. DeepSeek V4 Pro / V4.1 Flash 双向切换 ===')
  const deepseekPro = BUILTIN_API_MODELS.find((m) => m.id === 'api_deepseek_v4_pro')
  const deepseekFlash = BUILTIN_API_MODELS.find((m) => m.id === 'api_deepseek_flash')
  check('DeepSeek V4 Pro 使用官方模型 ID', deepseekPro?.model === 'deepseek-v4-pro', deepseekPro?.model)
  check('DeepSeek V4.1 Flash 使用官方模型 ID', deepseekFlash?.model === 'deepseek-flash', deepseekFlash?.model)
  modelRepo.updateModel(deepseekPro.id, { baseUrl: base, apiKey: 'sk-deepseek-provider' })
  modelRepo.updateModel(deepseekFlash.id, { baseUrl: base })
  for (const expected of [deepseekPro, deepseekFlash, deepseekPro]) {
    modelRepo.setActive(expected.id)
    const route = modelRoute(modelRepo.active(), settingsRepo.get())
    lastChatRequest = null
    await probeEndpoint(route.baseUrl, route.apiKey, 8000, route.model)
    check(
      `切换到 ${expected.name} 后真实请求使用 ${expected.model}`,
      modelRepo.state().activeId === expected.id
        && route.model === expected.model
        && lastChatRequest?.body?.model === expected.model
        && lastChatRequest?.authorization === 'Bearer sk-deepseek-provider',
      JSON.stringify({ state: modelRepo.state(), route, request: lastChatRequest })
    )
  }

  console.log('=== 9. 所有内置 API 厂商的真实请求路由 ===')
  const providerSamples = [...new Map(BUILTIN_API_MODELS.map((m) => [m.provider, m])).values()]
  for (const sample of providerSamples) {
    const key = 'sk-test-' + sample.provider
    modelRepo.updateModel(sample.id, { baseUrl: base, apiKey: key })
    modelRepo.setActive(sample.id)
    const route = modelRoute(modelRepo.active(), settingsRepo.get())
    lastChatRequest = null
    await probeEndpoint(route.baseUrl, route.apiKey, 8000, route.model)
    check(
      `${sample.provider} 使用所选模型、厂商密钥并发出 chat/completions`,
      lastChatRequest?.body?.model === sample.model && lastChatRequest?.authorization === 'Bearer ' + key,
      JSON.stringify(lastChatRequest)
    )
  }

  console.log('\n' + pass + '/' + (pass + fail) + ' 项通过')
  server.close()
  rmSync(OUT, { recursive: true, force: true })
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FAIL', e && e.message ? e.message : e)
  server.close()
  rmSync(OUT, { recursive: true, force: true })
  process.exit(1)
})
