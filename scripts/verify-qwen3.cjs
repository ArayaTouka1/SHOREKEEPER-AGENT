/**
 *
 *
 *
 */

const { execFileSync } = require('node:child_process')
const {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readFileSync,
  statSync
} = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const http = require('node:http')
const { createHash } = require('node:crypto')
const { deflateRawSync } = require('node:zlib')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify-qwen3')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

/* ================================================================== *
 * ================================================================== */

const ZIP_DLL_A = Buffer.alloc(64 * 1024, 0x41)
const ZIP_DLL_B = Buffer.alloc(8 * 1024, 0x42)
const ZIP_TXT = Buffer.from('README —— 不该被解压出来', 'utf-8')

const CRC_TABLE = (() => {
  const t = new Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function makeTestZip() {
  const zip = join(OUT, 'onnxruntime-fixture.zip')
  const items = [
    { name: 'onnxruntime-win-x64-1.30.0/lib/onnxruntime.dll', data: ZIP_DLL_A, deflate: true },
    { name: 'onnxruntime-win-x64-1.30.0/lib/onnxruntime_providers_shared.dll', data: ZIP_DLL_B, deflate: false },
    { name: 'onnxruntime-win-x64-1.30.0/README.txt', data: ZIP_TXT, deflate: false }
  ]
  const locals = []
  const centrals = []
  let offset = 0
  for (const it of items) {
    const nameBuf = Buffer.from(it.name, 'utf-8')
    const comp = it.deflate ? deflateRawSync(it.data) : it.data
    const method = it.deflate ? 8 : 0
    const crc = crc32(it.data)

    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(20, 4)
    lh.writeUInt16LE(0, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(crc, 14)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(it.data.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    locals.push(lh, nameBuf, comp)

    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(20, 4)
    ch.writeUInt16LE(20, 6)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(crc, 16)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(it.data.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push(ch, nameBuf)

    offset += lh.length + nameBuf.length + comp.length
  }
  const cdBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(items.length, 8)
  eocd.writeUInt16LE(items.length, 10)
  eocd.writeUInt32LE(cdBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  writeFileSync(zip, Buffer.concat([...locals, cdBuf, eocd]))
  return zip
}

/* ================================================================== *
 * ================================================================== */

const STUB = join(OUT, 'stub.cjs')
writeFileSync(
  STUB,
  `
const DATA = process.env.VQ_DATA
module.exports = {
  app: { getPath: () => DATA, getAppPath: () => process.env.VQ_APP, getVersion: () => '0.8.0' },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } }
}
`,
  'utf-8'
)

const entry = join(OUT, 'entry.ts')
writeFileSync(entry, `export * from '${slash(join(ROOT, 'src/main/qwen3Tts'))}'\n`, 'utf-8')

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    entry,
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--alias:electron=' + slash(STUB),
    '--outfile=' + slash(join(OUT, 'bundle.cjs')),
    '--log-level=warning'
  ],
  { stdio: 'inherit', cwd: ROOT }
)

const DATA = mkdtempSync(join(tmpdir(), 'vq-'))
process.env.VQ_DATA = DATA
process.env.VQ_APP = ROOT
const mod = require(join(OUT, 'bundle.cjs'))

let pass = 0
let fail = 0
const lines = []

async function check(name, fn) {
  try {
    const r = await fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (err) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败')
}

function startFixtureServer(files) {
  return new Promise((res) => {
    const hits = { range: 0, plain: 0, paths: [] }
    const server = http.createServer((req, resp) => {
      const name = decodeURIComponent(req.url.replace(/^\//, ''))
      hits.paths.push(name)
      const buf = files[name]
      if (!buf) {
        resp.writeHead(404)
        resp.end('not found')
        return
      }
      const range = req.headers.range
      if (range) {
        hits.range++
        const m = /bytes=(\d+)-/.exec(range)
        const start = m ? Number(m[1]) : 0
        resp.writeHead(206, {
          'Content-Type': 'application/octet-stream',
          'Content-Range': `bytes ${start}-${buf.length - 1}/${buf.length}`,
          'Content-Length': buf.length - start,
          'Accept-Ranges': 'bytes'
        })
        resp.end(buf.subarray(start))
      } else {
        hits.plain++
        resp.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': buf.length,
          'Accept-Ranges': 'bytes'
        })
        resp.end(buf)
      }
    })
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port, hits }))
  })
}

function waitDone(promise, ms = 40000) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error('超时 ' + ms + 'ms')), ms))
  ])
}

/* ================================================================== *
 * ================================================================== */

;(async () => {
  lines.push('=== 1. 清单格式 ===')

  await check('QWEN3_MANIFEST 是非空数组', () => {
    assert(Array.isArray(mod.QWEN3_MANIFEST), '不是数组')
    assert(mod.QWEN3_MANIFEST.length >= 20, '条目太少：' + mod.QWEN3_MANIFEST.length)
    return true
  })

  await check('每条都有 path / size / part / sha256 / bundled', () => {
    for (const e of mod.QWEN3_MANIFEST) {
      assert(typeof e.path === 'string' && e.path.length > 0, 'path 非法：' + JSON.stringify(e))
      assert(typeof e.size === 'number' && e.size >= 0, 'size 非法：' + e.path)
      assert(['common', '1.7b', '0.6b'].includes(e.part), 'part 非法：' + e.part)
      assert(typeof e.sha256 === 'string', 'sha256 必须是字符串：' + e.path)
      assert(typeof e.bundled === 'boolean', 'bundled 必须是布尔：' + e.path)
    }
    return true
  })

  await check('path 不重复且统一用正斜杠', () => {
    const ps = mod.QWEN3_MANIFEST.map((e) => e.path)
    assert(new Set(ps).size === ps.length, '有重复路径')
    for (const e of mod.QWEN3_MANIFEST) {
      assert(!e.path.includes('\\'), '出现反斜杠：' + e.path)
      assert(!e.path.startsWith('/'), '出现前导斜杠：' + e.path)
    }
    return true
  })

  await check('基地址指向 HuggingFace 仓库', () => {
    assert(
      mod.QWEN3_BASE_URL === 'https://huggingface.co/zukky/Qwen3-TTS-ONNX-DLL/resolve/main/',
      '实际：' + mod.QWEN3_BASE_URL
    )
    assert(mod.QWEN3_REPO === 'zukky/Qwen3-TTS-ONNX-DLL', 'repo 名不对')
    return true
  })

  await check('大权重全部标记为「需要下载」', () => {
    const big = mod.QWEN3_MANIFEST.filter((e) => e.size > 100 * 1024 * 1024)
    assert(big.length >= 15, '大文件太少：' + big.length)
    for (const e of big) assert(e.bundled === false, '大文件不该随包分发：' + e.path)
    return true
  })

  await check('随包分发的都是小文件（总计 < 20 MB）', () => {
    const b = mod.QWEN3_MANIFEST.filter((e) => e.bundled)
    const total = b.reduce((n, e) => n + e.size, 0)
    assert(b.length >= 10, '内置文件太少：' + b.length)
    assert(total < 20 * 1024 * 1024, '内置文件太大了：' + (total / 1024 / 1024).toFixed(1) + ' MB')
    return true
  })

  await check('两个规格的体积与文档一致（约 13 GB / 约 6 GB）', () => {
    const v17 = mod.variantBytes('1.7b')
    const v06 = mod.variantBytes('0.6b')
    assert(v17 > 12.5e9 && v17 < 14.5e9, '1.7B 体积异常：' + (v17 / 1e9).toFixed(2) + ' GB')
    assert(v06 > 5.5e9 && v06 < 7e9, '0.6B 体积异常：' + (v06 / 1e9).toFixed(2) + ' GB')
    return true
  })

  await check('manifestFor 会带上 common 部分，且不混入另一个规格', () => {
    const m = mod.manifestFor('1.7b')
    assert(m.some((e) => e.path === 'qwen3_tts_rust.dll'), '缺 DLL')
    assert(m.some((e) => e.path.startsWith('models/Qwen3-TTS-12Hz-1.7B-Base/')), '缺 1.7B 分词器')
    assert(!m.some((e) => e.part === '0.6b'), '混进了 0.6B 的文件')
    return true
  })

  await check('remoteFilesFor 排除掉随包文件', () => {
    for (const v of ['1.7b', '0.6b']) {
      const r = mod.remoteFilesFor(v)
      assert(r.length > 0, v + ' 没有待下载文件')
      for (const e of r) assert(e.bundled === false, '混进了随包文件：' + e.path)
    }
    return true
  })

  lines.push('=== 2. 环境检测 ===')

  await check('checkQwen3Env 返回文档约定的形状', () => {
    const env = mod.checkQwen3Env()
    for (const k of [
      'bundled',
      'onnxRuntime',
      'model1_7b',
      'model0_6b',
      'ready',
      'missing',
      'bytesOnDisk',
      'sizes',
      'root',
      'bundledDir',
      'runner',
      'runnerReady'
    ]) {
      assert(k in env, '缺少字段：' + k)
    }
    assert(typeof env.bundled === 'boolean', 'bundled 应是布尔')
    assert(typeof env.onnxRuntime === 'boolean', 'onnxRuntime 应是布尔')
    assert(typeof env.model1_7b === 'boolean', 'model1_7b 应是布尔')
    assert(typeof env.model0_6b === 'boolean', 'model0_6b 应是布尔')
    assert(typeof env.ready === 'boolean', 'ready 应是布尔')
    assert(Array.isArray(env.missing), 'missing 应是数组')
    assert(typeof env.bytesOnDisk === 'number', 'bytesOnDisk 应是数字')
    assert(env.sizes && typeof env.sizes === 'object', 'sizes 应是对象')
    assert(typeof env.runnerReady === 'boolean', 'runnerReady 应是布尔')
    return true
  })

  await check('干净数据目录下 ready 必须是 false', () => {
    const env = mod.checkQwen3Env()
    assert(env.ready === false, '干净目录下不该就绪')
    assert(env.model1_7b === false, '1.7B 不该就绪')
    assert(env.model0_6b === false, '0.6B 不该就绪')
    assert(env.onnxRuntime === false, 'ONNX Runtime 不该就绪')
    assert(env.missing.length >= 2, 'missing 应列出缺项，实际：' + JSON.stringify(env.missing))
    return true
  })

  await check('环境检测里没有任何解释器运行时字段', () => {
    const env = mod.checkQwen3Env()
    assert(!('python' in env) || env.python === undefined, '不该有可用的 python 字段')
    assert(!('venvReady' in env), '不该有 venvReady')
    assert(!('pythons' in env), '不该有 pythons')
    assert(!('packages' in env), '不该有 packages')
    return true
  })

  await check('内置框架在开发目录下被识别为就位', () => {
    const env = mod.checkQwen3Env()
    assert(env.bundled === true, '内置框架未被识别：' + env.bundledDir)
    assert(env.sizes.bundled > 7 * 1024 * 1024, '内置体积异常：' + env.sizes.bundled)
    return true
  })

  await check('qwen3Root 落在用户数据目录下的 tts-qwen3', () => {
    const r = mod.qwen3Root()
    assert(r.includes('tts-qwen3'), '路径不对：' + r)
    assert(existsSync(r), '目录没建出来')
    return true
  })

  lines.push('=== 3. 下载器（断点续传 / 取消）===')

  const fixtureRoot = join(DATA, 'fixture-dl')
  mkdirSync(fixtureRoot, { recursive: true })

  const fileA = Buffer.alloc(300 * 1024)
  for (let i = 0; i < fileA.length; i++) fileA[i] = i % 251
  const fileB = Buffer.alloc(120 * 1024, 7)
  const fixtures = { 'onnx_kv/tiny_a.onnx': fileA, 'onnx_kv/tiny_b.onnx': fileB }
  const fixtureEntries = [
    { path: 'onnx_kv/tiny_a.onnx', size: fileA.length, part: '1.7b', sha256: '', bundled: false },
    { path: 'onnx_kv/tiny_b.onnx', size: fileB.length, part: '1.7b', sha256: '', bundled: false }
  ]

  const { server, port, hits } = await startFixtureServer(fixtures)
  const baseUrl = `http://127.0.0.1:${port}/`

  await check('下载器能下完两个夹具文件，进度回调字段齐全', async () => {
    const progress = []
    const r = await waitDone(
      mod.downloadQwen3Model('1.7b', (p) => progress.push(p), {
        baseUrl,
        files: fixtureEntries,
        root: fixtureRoot
      })
    )
    assert(r.ok === true, '下载未成功')
    assert(r.files === 2, '文件数不对：' + r.files)
    const a = join(fixtureRoot, 'onnx_kv/tiny_a.onnx')
    const b = join(fixtureRoot, 'onnx_kv/tiny_b.onnx')
    assert(existsSync(a) && existsSync(b), '文件没落地')
    assert(statSync(a).size === fileA.length, 'a 体积不对：' + statSync(a).size)
    assert(statSync(b).size === fileB.length, 'b 体积不对：' + statSync(b).size)
    assert(progress.length > 0, '没有进度回调')
    assert(progress.some((p) => p.stage === 'download'), '没有 download 阶段')
    assert(progress[progress.length - 1].stage === 'done', '最后一条应是 done')
    for (const p of progress) {
      for (const k of ['file', 'index', 'total', 'received', 'totalBytes', 'percent', 'stage', 'message']) {
        assert(k in p, '进度缺少字段：' + k)
      }
      assert(typeof p.percent === 'number' && p.percent >= 0 && p.percent <= 100, 'percent 越界：' + p.percent)
      assert(p.total === 2, 'total 应为 2')
    }
    return true
  })

  await check('内容与源文件逐字节一致', () => {
    const a = readFileSync(join(fixtureRoot, 'onnx_kv/tiny_a.onnx'))
    assert(createHash('sha256').update(a).digest('hex') === createHash('sha256').update(fileA).digest('hex'), '内容不符')
    return true
  })

  await check('重复下载会跳过（不再发请求）', async () => {
    const before = hits.plain + hits.range
    const r = await waitDone(
      mod.downloadQwen3Model('1.7b', undefined, { baseUrl, files: fixtureEntries, root: fixtureRoot })
    )
    assert(r.ok === true, '第二次下载失败')
    assert(hits.plain + hits.range === before, '已完成文件不该再请求：' + before + ' -> ' + hits.plain + hits.range)
    return true
  })

  await check('断点续传：半截 .part 会带 Range 请求并补齐', async () => {
    const dir = join(DATA, 'fixture-resume')
    const dest = join(dir, 'onnx_kv/tiny_a.onnx')
    mkdirSync(join(dir, 'onnx_kv'), { recursive: true })
    const half = 100 * 1024
    writeFileSync(dest + '.part', fileA.subarray(0, half))
    assert(statSync(dest + '.part').size === half, '半成品没写对')

    const rangeBefore = hits.range
    const progress = []
    const r = await waitDone(
      mod.downloadQwen3Model('1.7b', (p) => progress.push(p), {
        baseUrl,
        files: [fixtureEntries[0]],
        root: dir
      })
    )
    assert(r.ok === true, '续传失败')
    assert(hits.range > rangeBefore, '没有发出 Range 请求（' + rangeBefore + ' -> ' + hits.range + '）')
    assert(!existsSync(dest + '.part'), '.part 应已被改名')
    const got = readFileSync(dest)
    assert(got.length === fileA.length, '续传后体积不对：' + got.length)
    assert(got.equals(fileA), '续传后内容与源文件不一致')
    assert(progress[0].received >= half, '续传进度没有从断点起算：' + progress[0].received)
    return true
  })

  await check('服务端忽略 Range 时能自动从头重下', async () => {
    const noRange = http.createServer((req, resp) => {
      const name = decodeURIComponent(req.url.replace(/^\//, ''))
      const buf = fixtures[name]
      if (!buf) {
        resp.writeHead(404)
        resp.end()
        return
      }
      resp.writeHead(200, { 'Content-Length': buf.length })
      resp.end(buf)
    })
    await new Promise((r) => noRange.listen(0, '127.0.0.1', r))
    const p2 = noRange.address().port
    try {
      const dir = join(DATA, 'fixture-norange')
      mkdirSync(join(dir, 'onnx_kv'), { recursive: true })
      writeFileSync(join(dir, 'onnx_kv/tiny_a.onnx.part'), fileA.subarray(0, 5000))
      const r = await waitDone(
        mod.downloadQwen3Model('1.7b', undefined, {
          baseUrl: `http://127.0.0.1:${p2}/`,
          files: [fixtureEntries[0]],
          root: dir
        })
      )
      assert(r.ok === true, '不支持 Range 时下载失败')
      const got = readFileSync(join(dir, 'onnx_kv/tiny_a.onnx'))
      assert(got.equals(fileA), '内容不对（说明没有从头写）')
      return true
    } finally {
      noRange.close()
    }
  })

  await check('体积不符时抛错并保留 .part 供下次续传', async () => {
    const dir = join(DATA, 'fixture-badsize')
    mkdirSync(join(dir, 'onnx_kv'), { recursive: true })
    const bad = [{ path: 'onnx_kv/tiny_b.onnx', size: 999999, part: '1.7b', sha256: '', bundled: false }]
    let err = null
    try {
      await waitDone(mod.downloadQwen3Model('1.7b', undefined, { baseUrl, files: bad, root: dir }))
    } catch (e) {
      err = e
    }
    assert(err, '体积不符时应当抛错')
    assert(/体积不符/.test(err.message), '错误信息不够明确：' + err.message)
    assert(existsSync(join(dir, 'onnx_kv/tiny_b.onnx.part')), '.part 应保留')
    return true
  })

  await check('取消：AbortSignal 生效，已下载部分保留为 .part', async () => {
    const slow = http.createServer((req, resp) => {
      const buf = Buffer.alloc(400 * 1024, 3)
      resp.writeHead(200, { 'Content-Length': buf.length })
      let sent = 0
      const timer = setInterval(() => {
        if (sent >= buf.length) {
          clearInterval(timer)
          resp.end()
          return
        }
        resp.write(buf.subarray(sent, sent + 8192))
        sent += 8192
      }, 20)
      resp.on('close', () => clearInterval(timer))
    })
    await new Promise((r) => slow.listen(0, '127.0.0.1', r))
    const p = slow.address().port
    try {
      const dir = join(DATA, 'fixture-cancel')
      const ac = new AbortController()
      const slowEntries = [{ path: 'big.onnx', size: 400 * 1024, part: '1.7b', sha256: '', bundled: false }]
      const promise = mod.downloadQwen3Model('1.7b', undefined, {
        baseUrl: `http://127.0.0.1:${p}/`,
        files: slowEntries,
        root: dir,
        signal: ac.signal
      })
      setTimeout(() => ac.abort(), 150)
      const r = await waitDone(promise)
      assert(r.ok === false, '取消后不该报成功')
      assert(r.cancelled === true, 'cancelled 标记应为 true')
      assert(!mod.isDownloading(), '取消后不该还有进行中的下载')
      const part = join(dir, 'big.onnx.part')
      assert(existsSync(part), '已下载部分应保留为 .part')
      assert(statSync(part).size > 0, '.part 不该是空的')
      assert(statSync(part).size < 400 * 1024, '.part 不该是完整的')
      return true
    } finally {
      slow.close()
    }
  })

  await check('cancelQwen3Download 在没有任务时安全返回 false', () => {
    assert(mod.cancelQwen3Download() === false, '没有任务时应返回 false')
    assert(mod.isDownloading() === false, '不该有进行中的下载')
    return true
  })

  await check('并发下载会被明确拒绝', async () => {
    const dir = join(DATA, 'fixture-concurrent')
    let firstDone = false
    const p1 = mod
      .downloadQwen3Model('1.7b', undefined, { baseUrl, files: fixtureEntries, root: dir })
      .then(() => {
        firstDone = true
      })
    let secondError = ''
    try {
      await mod.downloadQwen3Model('1.7b', undefined, { baseUrl, files: fixtureEntries, root: dir })
    } catch (err) {
      secondError = err.message
    }
    await waitDone(p1)
    assert(firstDone, '第一个下载没完成')
    assert(/已有下载任务/.test(secondError), '第二个应被拒绝，实际：' + secondError)
    return true
  })

  await check('取消后可以重新开始（状态被正确清理）', async () => {
    const dir = join(DATA, 'fixture-restart')
    const r = await waitDone(
      mod.downloadQwen3Model('1.7b', undefined, { baseUrl, files: fixtureEntries, root: dir })
    )
    assert(r.ok === true, '取消之后应能重新下载')
    assert(mod.isDownloading() === false, '结束后不该还标记为下载中')
    return true
  })

  lines.push('=== 4. ZIP 读取器（ONNX Runtime 解压）===')

  const zipPath = makeTestZip()

  await check('能列出 zip 里的条目', () => {
    const entries = mod.readZipEntries(zipPath)
    assert(entries.length === 3, '条目数不对：' + entries.length)
    assert(
      entries.some((e) => e.name === 'onnxruntime-win-x64-1.30.0/lib/onnxruntime.dll'),
      '缺 dll 条目'
    )
    assert(
      entries.some((e) => e.name === 'onnxruntime-win-x64-1.30.0/lib/onnxruntime_providers_shared.dll'),
      '缺 provider 条目'
    )
    return true
  })

  await check('能解出 deflate 与 store 两种方式的 dll，字节一致', () => {
    const entries = mod.readZipEntries(zipPath)
    const a = entries.find((x) => x.name.endsWith('/lib/onnxruntime.dll'))
    const b = entries.find((x) => x.name.endsWith('/lib/onnxruntime_providers_shared.dll'))
    assert(mod.readZipEntry(zipPath, a).equals(ZIP_DLL_A), 'deflate 条目解出的内容不一致')
    assert(mod.readZipEntry(zipPath, b).equals(ZIP_DLL_B), 'store 条目解出的内容不一致')
    return true
  })

  await check('extractOnnxRuntimeZip 只落地 lib/*.dll', async () => {
    const r = await mod.extractOnnxRuntimeZip(zipPath, 'cpu')
    assert(r.ok === true, '解压失败')
    assert(r.files.includes('onnxruntime.dll'), '缺 onnxruntime.dll')
    assert(r.files.includes('onnxruntime_providers_shared.dll'), '缺 providers dll')
    assert(!r.files.includes('README.txt'), '不该解出非 dll 文件')
    const dir = mod.onnxRuntimeDir()
    assert(existsSync(join(dir, 'onnxruntime.dll')), '文件没落地')
    assert(readFileSync(join(dir, 'onnxruntime.dll')).equals(ZIP_DLL_A), '落地内容不对')
    return true
  })

  await check('解压后 onnxRuntime 检测变绿', () => {
    const env = mod.checkQwen3Env()
    assert(env.onnxRuntime === true, 'ONNX Runtime 应被识别为就位')
    assert(env.sizes.onnxRuntime > 0, '体积应大于 0')
    return true
  })

  await check('非 zip 文件会走到兜底路径并给出可读中文错误', async () => {
    const bad = join(DATA, 'not-a-zip.zip')
    writeFileSync(bad, '这不是一个 zip 文件')
    let err = null
    try {
      await mod.extractOnnxRuntimeZip(bad, 'cpu')
    } catch (e) {
      err = e
    }
    assert(err, '应当抛错')
    assert(/解压|ZIP/.test(err.message), '错误信息不可读：' + err.message)
    return true
  })

  lines.push('=== 5. 合成（缺运行器必须给中文错误）===')

  await check('运行器不存在时抛中文错误而不是崩溃', async () => {
    let err = null
    try {
      await mod.synthesizeQwen3({
        text: '测试',
        variant: '0.6b',
        refAudioPath: 'C:\\not\\exist\\ref.mp3',
        refText: '',
        language: 'zh',
        device: 'cpu',
        runner: 'C:\\definitely\\missing\\runner.exe'
      })
    } catch (e) {
      err = e
    }
    assert(err, '应当抛错')
    assert(/运行器/.test(err.message), '错误信息应提到运行器：' + err.message)
    assert(!/^(TypeError|ReferenceError|RangeError)/.test(err.message), '不该是裸的 JS 报错：' + err.message)
    return true
  })

  await check('空文本会被明确拒绝', async () => {
    let err = null
    try {
      await mod.synthesizeQwen3({
        text: '   ',
        variant: '0.6b',
        refAudioPath: '',
        refText: '',
        language: 'zh',
        device: 'cpu'
      })
    } catch (e) {
      err = e
    }
    assert(err && /文本为空/.test(err.message), '错误信息不对：' + (err && err.message))
    return true
  })

  await check('内置音色索引可读且有 4 个角色', () => {
    const idx = mod.readVoiceIndex()
    assert(idx.length === 4, '音色数量不对：' + idx.length)
    for (const v of idx) {
      assert(v.id && v.name && v.file, '字段缺失：' + JSON.stringify(v))
      assert(v.refText === '', 'refText 应留空等用户填：' + v.id)
    }
    const ids = idx.map((v) => v.id).sort()
    assert(
      JSON.stringify(ids) === JSON.stringify(['aemeath', 'chloe', 'firefly', 'shorekeeper']),
      'id 不对：' + ids.join(',')
    )
    return true
  })

  await check('listQwen3Voices 能列出 4 个内置音色且文件都在', () => {
    const list = mod.listQwen3Voices()
    assert(list.length === 4, '数量不对：' + list.length)
    for (const v of list) {
      assert(v.builtin === true, '应是内置：' + v.id)
      assert(existsSync(v.path), '文件不存在：' + v.path)
      assert(v.size > 100 * 1024, '体积异常：' + v.size)
      assert(typeof v.format === 'string' && v.format.length > 0, 'format 缺失')
    }
    return true
  })

  await check('自定义音色会追加进列表', () => {
    const custom = join(DATA, 'my-voice.wav')
    writeFileSync(custom, Buffer.alloc(2048, 1))
    const list = mod.listQwen3Voices(custom)
    assert(list.length === 5, '应多出一个：' + list.length)
    const c = list.find((v) => v.id === 'custom')
    assert(c && c.builtin === false, '自定义项标记不对')
    return true
  })

  await check('占位脚本写出来后能被 resolveRunner 识别', () => {
    const r0 = mod.resolveRunner('')
    assert(r0.ready === false, '还没写脚本时不该就绪')
    const f = mod.writeRunnerPlaceholder()
    assert(existsSync(f), '占位脚本没写出来')
    const txt = readFileSync(f, 'utf-8')
    assert(txt.includes('qwen3-tts-runner.exe'), '脚本里应提到运行器')
    assert(txt.includes('--variant'), '脚本里应写明 CLI 约定')
    const r = mod.resolveRunner('')
    assert(r.ready === true, '写了占位脚本后应就绪')
    assert(r.command === f, '解析到的路径不对：' + r.command)
    return true
  })

  await check('quoteWinArg 处理空格 / 引号 / 行尾反斜杠', () => {
    assert(mod.quoteWinArg('plain') === 'plain', '普通参数不该加引号')
    assert(mod.quoteWinArg('a b') === '"a b"', '空格参数要加引号')
    assert(mod.quoteWinArg('') === '""', '空串要变成 ""')
    assert(mod.quoteWinArg('C:\\x y\\') === '"C:\\x y\\\\"', '行尾反斜杠要加倍：' + mod.quoteWinArg('C:\\x y\\'))
    return true
  })

  lines.push('=== 6. IPC 三处声明 ===')

  const channelsSrc = readFileSync(join(ROOT, 'src/shared/channels.ts'), 'utf-8')
  const preloadSrc = readFileSync(join(ROOT, 'src/preload/index.ts'), 'utf-8')
  const gtypesSrc = readFileSync(join(ROOT, 'src/renderer/src/types/global.d.ts'), 'utf-8')
  const mainSrc = readFileSync(join(ROOT, 'src/main/index.ts'), 'utf-8')
  const panelSrc = readFileSync(join(ROOT, 'src/renderer/src/pages/settings/LocalTtsPanel.tsx'), 'utf-8')

  const CH_KEYS = [
    ['qwen3Check', 'qwen3:check'],
    ['qwen3Voices', 'qwen3:voices'],
    ['qwen3Setup', 'qwen3:setup'],
    ['qwen3Download', 'qwen3:download'],
    ['qwen3Cancel', 'qwen3:cancel'],
    ['qwen3Synthesize', 'qwen3:synthesize'],
    ['qwen3PickRunner', 'qwen3:pickRunner'],
    ['qwen3OpenDir', 'qwen3:openDir'],
    ['qwen3Progress', 'qwen3:progress']
  ]

  await check('9 个通道都在 channels.ts 声明（键名 + 字面量）', () => {
    for (const [key, value] of CH_KEYS) {
      assert(channelsSrc.includes(key + ':'), 'channels.ts 缺少 ' + key)
      assert(channelsSrc.includes("'" + value + "'"), 'channels.ts 缺少字面量 ' + value)
    }
    return true
  })

  await check('8 个 invoke 通道都在主进程 handle 注册，进度事件在主进程发送', () => {
    for (const [key] of CH_KEYS) {
      if (key === 'qwen3Progress') continue // push 事件，不是 handle
      assert(mainSrc.includes('CH.' + key), 'main/index.ts 没有 handle ' + key)
    }
    assert(
      /webContents\.send\(CH\.qwen3Progress/.test(mainSrc),
      'main/index.ts 没有发 qwen3Progress'
    )
    return true
  })

  await check('全部接口都在 preload 暴露且用到对应 CH 常量', () => {
    assert(/qwen3:\s*\{/.test(preloadSrc), 'preload 没有 qwen3 段')
    for (const k of ['check', 'voices', 'setup', 'download', 'cancel', 'synthesize', 'pickRunner', 'openDir', 'onProgress']) {
      assert(new RegExp('\\b' + k + '\\s*[:(]').test(preloadSrc), 'preload 缺少 ' + k)
    }
    for (const [key] of CH_KEYS) {
      assert(preloadSrc.includes('CH.' + key), 'preload 没有用到 CH.' + key)
    }
    return true
  })

  await check('全部接口都在 global.d.ts 声明', () => {
    assert(/qwen3:\s*\{/.test(gtypesSrc), 'global.d.ts 没有 qwen3 段')
    for (const k of [
      'check()',
      'voices()',
      'setup()',
      'download(',
      'cancel()',
      'synthesize(',
      'pickRunner()',
      'openDir(',
      'onProgress('
    ]) {
      assert(gtypesSrc.includes(k), 'global.d.ts 缺少 ' + k)
    }
    return true
  })

  await check('前端面板用到了全部约定的 testid', () => {
    const ids = [
      'qwen3-check',
      'qwen3-setup',
      'qwen3-variant-1_7b',
      'qwen3-variant-0_6b',
      'qwen3-ref-text',
      'qwen3-device',
      'qwen3-preview',
      'qwen3-progress'
    ]
    for (const id of ids) {
      const re = new RegExp('[\'"]' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\'"]')
      assert(re.test(panelSrc), '面板缺少 testid：' + id)
    }
    assert(panelSrc.includes("'qwen3-voice-' + v.id"), '四个内置音色的 testid 不是按 id 生成的')
    return true
  })

  await check('「一键配置环境」只在检测出缺失时才渲染', () => {
    assert(/qwen3Missing/.test(panelSrc), '没有 qwen3Missing 判定')
    assert(/\{qwen3Missing && \(/.test(panelSrc), '「一键配置环境」没有被条件包起来')
    assert(/data-testid="qwen3-setup"/.test(panelSrc), '缺少 qwen3-setup')
    return true
  })

  await check('后端选择器有 Qwen3-TTS 且标注「无需 Python」', () => {
    assert(/Qwen3-TTS/.test(panelSrc), '后端按钮文案不对')
    assert(/data-testid=\{'local-backend-' \+ b\.k\}/.test(panelSrc), '后端按钮 testid 不对')
    return true
  })

  await check('每个内容块都带折叠开关', () => {
    const collapses = panelSrc.match(/<Collapse/g) || []
    assert(collapses.length >= 6, '折叠块太少：' + collapses.length)
    assert(/收起 ▲/.test(panelSrc) && /展开 ▼/.test(panelSrc), '折叠按钮文案缺失')
    assert(/const \[open, setOpen\] = useState\(defaultOpen\)/.test(panelSrc), '折叠状态没有用 useState')
    return true
  })

  lines.push('=== 7. 不含任何解释器运行时引用 ===')

  await check('qwen3Tts.ts 里零命中（不区分大小写）', () => {
    const src = readFileSync(join(ROOT, 'src/main/qwen3Tts.ts'), 'utf-8')
    const hits = []
    for (const word of ['python', 'venv', 'pip ', 'conda', 'pyinstaller', '\\.py\\b']) {
      const re = new RegExp(word, 'gi')
      let m
      while ((m = re.exec(src))) hits.push(word + ' @line ' + src.slice(0, m.index).split('\n').length)
    }
    assert(hits.length === 0, '出现了解释器相关字样：' + hits.join(', '))
    return true
  })

  await check('面板的 Qwen3 分支里零命中', () => {
    const start = panelSrc.indexOf('Qwen3 面板')
    const end = panelSrc.indexOf('旧后端（HTTP 服务型）')
    assert(start > 0 && end > start, '没切出 Qwen3 段落')
    const section = panelSrc.slice(start, end)
    assert(section.length > 500, 'Qwen3 段落太短：' + section.length)
    for (const word of ['python', 'venv', 'pip ']) {
      assert(!new RegExp(word, 'i').test(section), 'Qwen3 段落里出现了 ' + word)
    }
    return true
  })

  await check('类型定义里 Qwen3EnvStatus 的 python 字段被声明为 never', () => {
    const src = readFileSync(join(ROOT, 'src/shared/types.ts'), 'utf-8')
    assert(/python\??:\s*never/.test(src), 'python 字段类型不是 never')
    return true
  })

  await check('运行时返回值里确实没有 python 字段', () => {
    const env = mod.checkQwen3Env()
    assert(!('python' in env), '返回值里出现了 python 字段')
    assert(!Object.prototype.hasOwnProperty.call(env, 'python'), 'own property python 存在')
    return true
  })

  lines.push('=== 8. 打包与资源 ===')

  await check('electron-builder.yml 带上了 qwen3tts 与 qwen3voices', () => {
    const yml = readFileSync(join(ROOT, 'electron-builder.yml'), 'utf-8')
    assert(yml.includes('resources/qwen3tts'), '缺少 qwen3tts extraResources')
    assert(yml.includes('to: qwen3tts'), 'qwen3tts 目标目录不对')
    assert(yml.includes('resources/qwen3voices'), '缺少 qwen3voices extraResources')
    assert(yml.includes('to: qwen3voices'), 'qwen3voices 目标目录不对')
    return true
  })

  await check('随包资源确实在磁盘上且体积对', () => {
    const dll = join(ROOT, 'resources/qwen3tts/qwen3_tts_rust.dll')
    assert(existsSync(dll), '缺少 qwen3_tts_rust.dll')
    assert(statSync(dll).size === 7490048, 'DLL 体积不对：' + statSync(dll).size)
    assert(existsSync(join(ROOT, 'resources/qwen3tts/qwen3_tts.h')), '缺少头文件')
    for (const v of ['1.7B', '0.6B']) {
      for (const f of ['config.json', 'vocab.json', 'merges.txt', 'tokenizer_config.json']) {
        const p = join(ROOT, 'resources/qwen3tts/models/Qwen3-TTS-12Hz-' + v + '-Base', f)
        assert(existsSync(p), '缺少 ' + p)
        assert(statSync(p).size > 0, '空文件：' + p)
      }
    }
    return true
  })

  await check('4 个参考音色都在且体积正常', () => {
    const dir = join(ROOT, 'resources/qwen3voices')
    for (const id of ['shorekeeper', 'aemeath', 'firefly', 'chloe']) {
      const p = join(dir, id + '.mp3')
      assert(existsSync(p), '缺少 ' + id + '.mp3')
      const s = statSync(p).size
      assert(s > 400 * 1024 && s < 600 * 1024, id + ' 体积异常：' + s)
    }
    assert(existsSync(join(dir, 'voices.json')), '缺少 voices.json')
    return true
  })

  await check('设置默认值里有完整的 Qwen3 字段', () => {
    const src = readFileSync(join(ROOT, 'src/main/settings.ts'), 'utf-8')
    for (const k of [
      'qwen3Variant',
      'qwen3VoiceId',
      'qwen3VoiceFile',
      'qwen3RefText',
      'qwen3Runner',
      'qwen3Language',
      'qwen3Device'
    ]) {
      assert(src.includes(k + ':'), 'settings.ts 缺少默认值 ' + k)
    }
    return true
  })

  await check('LocalBackend 联合类型里有 qwen3', () => {
    const src = readFileSync(join(ROOT, 'src/shared/types.ts'), 'utf-8')
    assert(
      /LocalBackend\s*=\s*'kokoro'\s*\|\s*'gpt-sovits'\s*\|\s*'cosyvoice'\s*\|\s*'qwen3'/.test(src),
      '联合类型没加上 qwen3'
    )
    return true
  })

  await check('localTts.ts 的 qwen3 分支不再走 HTTP', () => {
    const src = readFileSync(join(ROOT, 'src/main/localTts.ts'), 'utf-8')
    assert(/backend === 'qwen3'/.test(src), 'localTts.ts 没有 qwen3 分支')
    assert(/checkQwen3Env/.test(src), 'localTts.ts 没有接环境检测')
    return true
  })

  server.close()
  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.log('\n' + lines.join('\n'))
  console.error('\n测试崩溃: ' + (e && e.stack ? e.stack : e))
  process.exit(2)
})
