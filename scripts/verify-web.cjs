/**
 *
 *
 *
 */
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-web')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

const PROFILE = mkdtempSync(join(tmpdir(), 'sk-web-'))
writeFileSync(
  join(PROFILE, 'stub.cjs'),
  `module.exports = {
  app: {
    getPath: (k) => ${JSON.stringify(slash(PROFILE))},
    getAppPath: () => ${JSON.stringify(slash(ROOT))}, isPackaged: false, getVersion: () => '0.21.0'
  },
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
  `export { runAgentTool, AGENT_TOOLS } from '${slash(join(ROOT, 'src/main/agentTools'))}'\n`,
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

const mod = require(join(OUT, 'bundle.cjs'))

let pass = 0
let fail = 0
const check = (n, c, e) => { if (c) { pass++; console.log('  OK   ' + n) } else { fail++; console.log('  FAIL ' + n + (e ? '  -> ' + e : '')) } }

;(async () => {
  console.log('=== 1. 工具清单 ===')
  const names = (mod.AGENT_TOOLS || []).map((t) => t.name)
  check('存在 web_search 工具', names.includes('web_search'), JSON.stringify(names.filter((n) => n.startsWith('web'))))
  check('存在 web_fetch 工具', names.includes('web_fetch'))

  console.log('=== 2. 真实联网搜索 ===')
  let searchRes
  try {
    searchRes = await mod.runAgentTool('web_search', { query: '鸣潮 守岸人 角色介绍' })
  } catch (e) {
    searchRes = { ok: false, error: e && e.message }
  }
  const sr = searchRes && searchRes.result ? searchRes.result : searchRes
  const results = (sr && sr.results) || []
  check('搜索返回结果（真实网络）', results.length > 0, JSON.stringify({ ok: searchRes?.ok, count: sr?.count, err: sr?.error, source: sr?.source }).slice(0, 260))
  if (results.length > 0) {
    check('结果含可用 http 链接', results.some((r) => /^https?:\/\//.test(r.url)), JSON.stringify(results[0]).slice(0, 200))
    check('结果含标题', results.some((r) => r.title && r.title.length > 1), JSON.stringify(results[0]?.title))
    console.log('    首条: ' + (results[0]?.title || '').slice(0, 60))
    console.log('    链接: ' + (results[0]?.url || '').slice(0, 90))
    console.log('    来源: ' + (sr?.source || '未知'))
  }

  console.log('=== 3. 真实网页抓取 ===')
  let fetchRes
  try {
    fetchRes = await mod.runAgentTool('web_fetch', { url: 'https://www.bing.com' })
  } catch (e) {
    fetchRes = { ok: false, error: e && e.message }
  }
  const fr = fetchRes && fetchRes.result ? fetchRes.result : fetchRes
  check('抓取返回正文', !!(fr && fr.text && fr.text.length > 100), JSON.stringify({ ok: fetchRes?.ok, len: fr?.text?.length, err: fetchRes?.error }).slice(0, 200))

  console.log('\n' + pass + '/' + (pass + fail) + ' 项通过')

  rmSync(OUT, { recursive: true, force: true })
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch { /* 忽略 */ }
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.error('FAIL', e && e.message ? e.message : e)
  rmSync(OUT, { recursive: true, force: true })
  process.exit(1)
})
