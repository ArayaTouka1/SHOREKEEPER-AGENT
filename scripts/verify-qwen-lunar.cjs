const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/main/qwenLunar.ts'), 'utf8')
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exportsObject = {}
const written = []
let response
let request
const context = {
  exports: exportsObject, URL, AbortSignal, Buffer, Date,
  require(name) {
    if (name === 'electron') return { app: { getPath: () => path.join(root, '.verification/qwen-lunar') } }
    if (name === 'node:fs') return { existsSync: p => p === 'reference.wav', mkdirSync() {}, writeFileSync: (p, data) => written.push({ p, data }) }
    return require(name)
  },
  fetch: async (url, options) => { request = { url: String(url), options }; return response }
}
vm.runInNewContext(output, context)
async function main() {
  const { localQwenUrl, checkLunarService, synthesizeLunar } = exportsObject
  for (const url of ['https://example.com', 'http://192.168.1.2', 'http://localhost@evil.com', 'file:///C:/test', 'http://localhost/path']) {
    assert.throws(() => localQwenUrl(url))
  }
  assert.equal(localQwenUrl('').port, '36365')
  response = { ok: true, json: async () => ({ status: 'ok', service: 'simple-tts' }) }
  assert.equal((await checkLunarService('')).online, true)
  response = { ok: true, json: async () => ({ status: 'ok', service: 'wrong' }) }
  assert.equal((await checkLunarService('')).online, false)
  await assert.rejects(synthesizeLunar({ endpoint: '', text: 'test', refAudioPath: 'missing.wav' }))
  response = { ok: true, json: async () => ({ success: true, audio: Buffer.from('invalid').toString('base64') }) }
  await assert.rejects(synthesizeLunar({ endpoint: '', text: 'test', refAudioPath: 'reference.wav' }))
  const wav = Buffer.alloc(100)
  wav.write('RIFF', 0); wav.write('WAVE', 8)
  response = { ok: true, json: async () => ({ success: true, audio: wav.toString('base64') }) }
  const result = await synthesizeLunar({ endpoint: '', text: 'test', refAudioPath: 'reference.wav' })
  assert.equal(result.bytes, 100)
  assert.equal(written.length, 1)
  assert.equal(request.url, 'http://127.0.0.1:36365/tts')
  assert.equal(JSON.parse(request.options.body).ref_audio, 'reference.wav')
  assert.equal(request.options.redirect, 'error')
  assert.equal(fs.existsSync(path.join(root, 'src/main/kokoroTts.ts')), false)
  assert.equal(fs.existsSync(path.join(root, 'src/main/kokoro-worker.cjs')), false)
  console.log('PASS: Qwen local protocol, reference forwarding, WAV validation, local-only endpoint, Kokoro removal. Mock test only; real inference not tested.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
