/**
 * 自定义云端语音连接验证（静默，mock 服务）
 *
 * 背景：反馈「自定义云端语音连接不上」。根因：
 *   1. 所有 fetch 无超时 → 网络不通时界面一直转圈
 *   2. 音色列表拉取失败被静默吞掉 → 用户看不到原因
 *   3. 缺 model/voiceId 时直接返回「端点可达」→ 假成功，实际合成会失败
 *
 * 覆盖：
 *   1. 音色列表可用 → 连通成功
 *   2. 列表不可用但能合成 → 仍判成功（实测优先）
 *   3. 缺 model/voiceId → 明确要求补全（不再假成功）
 *   4. 鉴权失败 → 明确的 HTTP 状态与响应体
 *   5. 网络不可达 → 明确的中文网络错误（不无限等待）
 *
 * 用法：node scripts/verify-cloud-tts.cjs
 */
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-cloud')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const PROFILE = mkdtempSync(join(tmpdir(), 'sk-cloud-'))
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

writeFileSync(
  join(OUT, 'entry.ts'),
  `export { testConnection, listCloudVoices, synthesize } from '${slash(join(ROOT, 'src/main/cloudTts'))}'\n`,
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

const cloud = require(join(OUT, 'bundle.cjs'))

/* ---------------- mock 服务 ---------------- */
const PORT = 36630
let scene = 'voices'
const server = http.createServer((req, res) => {
  if (scene === 'voices' && req.url.includes('/voices')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'alloy' }, { id: 'echo' }] }))
    return
  }
  if (scene === 'synth-only' && req.url.includes('/audio/speech')) {
    // 返回一小段假 mp3
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' })
    res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x00, 0x00]))
    return
  }
  if (scene === 'auth') {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
    return
  }
  // 其余：列表探测一律 404，合成一律 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'not found' }))
})

const baseCfg = (over = {}) => ({
  provider: 'custom',
  apiKey: 'sk-test',
  baseUrl: 'http://127.0.0.1:' + PORT + '/v1',
  model: '',
  authMode: 'bearer',
  customModels: [],
  voicesPath: '',
  speechPath: '',
  voiceId: '',
  ...over
})

let pass = 0
let fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('  OK   ' + n) } else { fail++; console.log('  FAIL ' + n + (e ? '  -> ' + e : '')) } }

;(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

  console.log('=== 1. 音色列表可用 ===')
  scene = 'voices'
  const r1 = await cloud.testConnection(baseCfg())
  check('连通成功并报告音色数', r1.ok === true && r1.voices === 2, JSON.stringify(r1))

  console.log('=== 2. 列表不可用但能合成（实测优先） ===')
  scene = 'synth-only'
  const r2 = await cloud.testConnection(baseCfg({ model: 'tts-1', voiceId: 'alloy' }))
  check('合成成功即判连通（不再因列表缺失而失败）', r2.ok === true && /合成测试成功/.test(r2.message), JSON.stringify(r2).slice(0, 200))

  console.log('=== 3. 缺 model/voiceId（不再假成功） ===')
  const r3 = await cloud.testConnection(baseCfg())
  check('明确要求补全参数（不再返回「端点可达」假成功）', r3.ok === false && /模型/.test(r3.message), JSON.stringify(r3).slice(0, 200))
  check('错误里带音色列表探测的真实原因', /音色列表探测/.test(r3.message), r3.message.slice(0, 150))

  console.log('=== 4. 鉴权失败 ===')
  scene = 'auth'
  const r4 = await cloud.testConnection(baseCfg({ model: 'tts-1', voiceId: 'alloy' }))
  check('判为失败', r4.ok === false)
  check('报出 HTTP 401 与服务端说明', /401/.test(r4.message), r4.message.slice(0, 200))
  check('带音色列表探测明细', /音色列表探测/.test(r4.message), r4.message.slice(0, 150))

  console.log('=== 5. 网络不可达（有超时，不无限等待） ===')
  const t0 = Date.now()
  const r5 = await cloud.testConnection(baseCfg({
    baseUrl: 'http://127.0.0.1:1/v1', // 必然拒绝
    model: 'tts-1',
    voiceId: 'alloy'
  }))
  const elapsed = Date.now() - t0
  check('判为失败', r5.ok === false)
  check('给出网络错误说明', /网络请求失败|超时/.test(r5.message), r5.message.slice(0, 200))
  check('快速失败（未无限等待，< 30 秒）', elapsed < 30000, elapsed + 'ms')

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
