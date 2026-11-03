const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { buildSync } = require('esbuild')
const compile = file => buildSync({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text
function load(code, electron) {
  const module = { exports: {} }
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'electron' ? electron : require(name), Response, URL, console, process })
  return module.exports
}
async function main() {
  const fixture = path.resolve('.verification/avatar-path/我的 头像#1.png')
  fs.mkdirSync(path.dirname(fixture), { recursive: true })
  fs.copyFileSync('build/icon.png', fixture)
  const url = load(compile('src/renderer/src/utils/localUrl.ts')).normalizeStoredUrl('file:///' + fixture.replace(/\\/g, '/'))
  assert.ok(url.includes('%23'))
  assert.equal(decodeURIComponent(new URL(url).pathname).slice(1).replace(/\//g, '\\'), fixture)
  const handlers = {}
  let protocolHandler
  let fetched
  const electron = {
    app: { getPath: () => 'Z:\\unrelated', getAppPath: () => 'Z:\\unrelated' },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [fixture] }) },
    ipcMain: { handle: (key, fn) => { handlers[key] = fn } },
    protocol: { handle: (_name, fn) => { protocolHandler = fn } },
    net: { fetch: async url => { fetched = url; return new Response('image') } },
    BrowserWindow: { getAllWindows: () => [] }, shell: {}
  }
  // Bundle both modules together so the protocol and picker share the same allowlist.
  const code = buildSync({ stdin: { contents: "export { registerSystemIpc } from './src/main/ipc'; export { installAppFileProtocol } from './src/main/localFile'", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], write: false }).outputFiles[0].text
  const api = load(code, electron)
  api.installAppFileProtocol(); api.registerSystemIpc()
  assert.equal((await protocolHandler({ url })).status, 403)
  const channels = load(compile('src/shared/channels.ts')).CH
  const picked = await handlers[channels.pickImage]({})
  assert.equal(picked.data, fixture)
  assert.equal((await protocolHandler({ url })).status, 200)
  assert.equal(require('node:url').fileURLToPath(fetched), fixture)
  console.log('PASS picker grants exact file access; Chinese/space/# URL roundtrip; unrelated paths remain blocked')
}
main().catch(e => { console.error(e); process.exitCode = 1 })
