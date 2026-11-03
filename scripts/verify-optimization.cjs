const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const vm = require('node:vm')
const esbuild = require('esbuild')

async function main() {
  const root = path.resolve(__dirname, '..')
  const base = path.join(root, '.verification')
  fs.mkdirSync(base, { recursive: true })
  const temp = fs.mkdtempSync(path.join(base, 'optimization-'))
  const data = path.join(temp, 'data')
  fs.mkdirSync(data)
  const legacy = { conversations: ['a', 'b'].map(id => ({ id, characterId: 'char', title: id, summary: '', createdAt: 1, updatedAt: 1, messageCount: 1 })), messages: ['a', 'b'].map(id => ({ id: `m-${id}`, conversationId: id, role: 'user', text: `旧记录 ${id}`, createdAt: 1 })) }
  const legacyText = JSON.stringify(legacy)
  fs.writeFileSync(path.join(data, 'chat.json'), legacyText)
  const bundle = path.join(temp, 'api.cjs')
  await esbuild.build({ stdin: { contents: "export * from './src/main/chat'; export * from './src/main/conversationTurns'; export * from './src/main/toolConversation'; export * from './src/renderer/src/utils/disposeModel'; export * from './src/renderer/src/utils/mmdResources'; export * from './src/renderer/src/utils/callRender';", resolveDir: root }, bundle: true, platform: 'node', format: 'cjs', external: ['three'], outfile: bundle, plugins: [{ name: 'isolated-electron', setup(build) {
    build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'mock' }))
    build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `export const app={getPath:()=>${JSON.stringify(temp)}}; export const net={fetch:(...args)=>fetch(...args)}; export const session={};` }))
  } }] })
  let api = require(bundle)
  let passed = 0
  const test = async (name, fn) => { await fn(); passed++; console.log('PASS ' + name) }
  await test('legacy chat migration preserves records and original backup', () => {
    assert.equal(api.chatRepo.messages('a')[0].text, '旧记录 a')
    assert.equal(api.chatRepo.messages('b')[0].text, '旧记录 b')
    assert.equal(fs.readFileSync(path.join(data, 'chat.json'), 'utf8'), legacyText)
  })
  await test('saving one conversation does not rewrite another conversation', () => {
    const crypto = require('node:crypto')
    const other = path.join(data, 'chat-messages', crypto.createHash('sha256').update('b').digest('hex') + '.json')
    const before = fs.statSync(other).mtimeMs
    const msg = api.chatRepo.append({ conversationId: 'a', role: 'character', text: '新回复' })
    api.chatRepo.updateMessage(msg.id, { text: '更新后的回复', conversationId: 'b' })
    assert.equal(api.chatRepo.messages('a').at(-1).text, '更新后的回复')
    assert.equal(api.chatRepo.messages('b').length, 1)
    assert.equal(fs.statSync(other).mtimeMs, before)
  })
  await test('restart reads migrated data and deleted chats stay deleted', () => {
    delete require.cache[bundle]; api = require(bundle)
    assert.equal(api.chatRepo.messages('a').at(-1).text, '更新后的回复')
    api.chatRepo.delete('b')
    delete require.cache[bundle]; api = require(bundle)
    assert.deepEqual(api.chatRepo.messages('b'), [])
    assert.equal(api.chatRepo.conversations().length, 1)
    assert.throws(() => api.chatRepo.append({ conversationId: 'b', role: 'character', text: '迟到回复' }), /不存在/)
  })
  await test('superseded request cannot finish or cancel its replacement', () => {
    const turns = new api.ConversationTurns()
    const old = turns.start('call')
    const next = turns.start('call')
    assert.equal(old.controller.signal.aborted, true)
    old.finish()
    assert.equal(next.isCurrent(), true)
    assert.equal(next.controller.signal.aborted, false)
    turns.cancel('call')
    assert.equal(next.controller.signal.aborted, true)
    next.finish()
  })
  await test('generation deadline aborts an unanswered request', async () => {
    const turns = new api.ConversationTurns()
    const turn = turns.start('timeout', 15)
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(turn.controller.signal.reason.name, 'TimeoutError')
    turn.finish()
  })
  await test('shared model textures, geometry and skeleton are released once', () => {
    const THREE = require('three')
    const group = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const texture = new THREE.Texture()
    const material = new THREE.MeshBasicMaterial({ map: texture })
    let released = 0
    for (const item of [geometry, texture, material]) item.addEventListener('dispose', () => released++)
    group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material))
    api.disposeModel(group)
    assert.equal(released, 3)
    assert.equal(api.callRenderKey('char_shorekeeper', '', 'C:/model.glb'), 'C:/model.glb')
  })
  await test('real Ammo worlds can simulate and release MMD bodies repeatedly', async () => {
    const THREE = require('three')
    const common = { exports: {} }
    const ammoDirectory = path.join(root, 'node_modules/three/examples/jsm/libs')
    vm.runInNewContext(fs.readFileSync(path.join(ammoDirectory, 'ammo.wasm.js'), 'utf8'), { module: common, exports: common.exports, require, __dirname: ammoDirectory, process, console, Buffer, WebAssembly, TextDecoder, setTimeout, clearTimeout })
    const factory = common.exports
    const ammo = await factory({ wasmBinary: fs.readFileSync(path.join(root, 'node_modules/three/examples/jsm/libs/ammo.wasm.wasm')) })
    global.Ammo = ammo
    const { MMDPhysics } = await import('three/examples/jsm/animation/MMDPhysics.js')
    for (let cycle = 0; cycle < 3; cycle++) {
      const world = api.createMmdWorld(ammo)
      const mesh = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
      const bone = new THREE.Bone(); mesh.add(bone); mesh.bind(new THREE.Skeleton([bone])); mesh.updateMatrixWorld(true)
      const physics = new MMDPhysics(mesh, [{ boneIndex: 0, type: 0, shapeType: 0, width: .1, height: .1, depth: .1, weight: 1, position: [0, 0, 0], rotation: [0, 0, 0], friction: .5, restitution: 0, positionDamping: .1, rotationDamping: .1, groupIndex: 0, groupTarget: -1 }], [], { world: world.world })
      physics.update(1 / 60)
      world.dispose(physics)
      world.dispose(physics)
      api.disposeModel(mesh)
    }
    delete global.Ammo
  })
  let rounds = 0, fallbackRounds = 0, toolsExecuted = 0
  const received = []
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw); received.push(body)
    if (req.url === '/fallback') {
      fallbackRounds++
      if (body.stream) { res.writeHead(400); res.end('stream is unsupported'); return }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '兼容回复' } }] })); return
    }
    res.setHeader('Content-Type', 'text/event-stream')
    if (req.url === '/hang') { res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: '部分' } }] }) + '\n\n'); return }
    const deltas = rounds++ === 0
      ? [{ tool_calls: [{ index: 0, id: 'call-1', function: { name: 'fs_write', arguments: '{"path":"中文.txt",' } }] }, { tool_calls: [{ index: 0, function: { arguments: '"content":"真实内容"}' } }] }]
      : [{ content: '已保存' }, { content: ' 中文文件' }]
    const payload = deltas.map(delta => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\r\n\r\n').join('') + 'data: [DONE]'
    const bytes = Buffer.from(payload)
    for (let start = 0; start < bytes.length; start += 7) {
      res.write(bytes.subarray(start, start + 7))
      await new Promise(resolve => setImmediate(resolve))
    }
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = `http://127.0.0.1:${server.address().port}`
  const options = { url: address, apiKey: '', model: 'test', messages: [{ role: 'user', content: '写文件' }], maxTokens: 128, tools: [{ name: 'fs_write', description: 'write', params: [] }], signal: new AbortController().signal, stream: true, execute: async (name, params) => { toolsExecuted++; assert.equal(name, 'fs_write'); assert.equal(params.path, '中文.txt'); return '已写入' } }
  try {
    await test('streaming tool arguments survive byte fragmentation and execute exactly once', async () => {
      const deltas = []
      const result = await api.toolConversation({ ...options, onDelta: text => deltas.push(text) })
      assert.equal(result, '已保存 中文文件')
      assert.deepEqual(deltas, ['已保存', ' 中文文件'])
      assert.equal(toolsExecuted, 1)
      assert.equal(received[1].messages.at(-1).content, '已写入')
    })
    await test('nonstreaming endpoint fallback does not repeat tool execution', async () => {
      const deltas = []
      assert.equal(await api.toolConversation({ ...options, url: address + '/fallback', onDelta: text => deltas.push(text) }), '兼容回复')
      assert.equal(fallbackRounds, 2); assert.equal(toolsExecuted, 1); assert.deepEqual(deltas, ['兼容回复'])
    })
    await test('cancel aborts a streaming response before it can execute tools', async () => {
      const controller = new AbortController()
      await assert.rejects(api.toolConversation({ ...options, url: address + '/hang', signal: controller.signal, onDelta: () => controller.abort() }), error => error.name === 'AbortError')
      assert.equal(toolsExecuted, 1)
    })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  const sttBuild = await esbuild.build({ entryPoints: [path.join(root, 'src/renderer/src/services/localSpeechRecognition.ts')], bundle: true, platform: 'browser', format: 'iife', globalName: 'speech', write: false, define: { 'import.meta.url': JSON.stringify('file:///speech.js') } })
  let workerCount = 0
  let respond = true
  class Worker {
    constructor() { workerCount++ }
    postMessage(message) { if (respond) setTimeout(() => this.onmessage?.({ data: { type: 'result', id: message.id, text: '识别结果' } }), 1) }
    terminate() { this.onmessage = null }
  }
  const context = vm.createContext({ Worker, URL, DOMException, console, window: { setTimeout: (fn, ms) => setTimeout(fn, ms === 90000 ? 20 : ms), clearTimeout }, Float32Array })
  vm.runInContext(sttBuild.outputFiles[0].text, context)
  const sample = new Float32Array(16000)
  for (let i = 3200; i < 12800; i++) sample[i] = Math.sin(i * .15) * .2
  await test('silent input never starts recognition', async () => {
    assert.equal(await context.speech.transcribeLocalSpeech(new Float32Array(16000), 16000, 'zh', () => {}), '')
    assert.equal(workerCount, 0)
  })
  await test('cancelled and timed out recognition can recover with a fresh worker', async () => {
    respond = false
    const task = context.speech.transcribeLocalSpeech(sample, 16000, 'zh', () => {})
    context.speech.cancelLocalSpeechRecognition()
    await assert.rejects(task, error => error.name === 'AbortError')
    await assert.rejects(context.speech.transcribeLocalSpeech(sample, 16000, 'zh', () => {}), /超时/)
    respond = true
    assert.equal(await context.speech.transcribeLocalSpeech(sample, 16000, 'zh', () => {}), '识别结果')
    assert.equal(workerCount, 3)
  })
  console.log(`Completed ${passed} optimization checks; isolated data: ${temp}`)
}

main().catch(error => { console.error(error); process.exitCode = 1 })
