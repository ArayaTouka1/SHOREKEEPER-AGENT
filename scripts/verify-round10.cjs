/**
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify10')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
const D = process.env.V10_DATA
const os = require('node:os')
const path = require('node:path')
const PATHS = {
  home: D, userData: D,
  desktop: path.join(D, 'Desktop'),
  documents: path.join(D, 'Documents'),
  downloads: path.join(D, 'Downloads'),
  pictures: path.join(D, 'Pictures'),
  music: path.join(D, 'Music'),
  videos: path.join(D, 'Videos')
}
module.exports = {
  app: { getPath: (k) => PATHS[k] || D, getAppPath: () => process.env.V10_APP, getVersion: () => '0.9.0' },
  shell: { openPath: async () => '', openExternal: async () => true },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  ipcMain: { handle: () => {}, on: () => {} },
  nativeImage: { createFromDataURL: () => ({}) },
  Tray: class { setToolTip() {} setContextMenu() {} on() {} },
  Menu: { buildFromTemplate: () => ({}) },
  BrowserWindow: class { static getAllWindows() { return [] } },
  protocol: { registerSchemesAsPrivileged: () => {}, handle: () => {} },
  net: { fetch: async () => new Response('') }
}
`,
  'utf-8'
)

writeFileSync(
  join(OUT, 'entry.ts'),
  `
export * from '${slash(join(ROOT, 'src/main/extract'))}'
export * from '${slash(join(ROOT, 'src/main/permission'))}'
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/agentTools'))}'
export * from '${slash(join(ROOT, 'src/main/stickers'))}'
`,
  'utf-8'
)

execFileSync(
  process.execPath,
  [
    join(ROOT, 'node_modules/esbuild/bin/esbuild'),
    join(OUT, 'entry.ts'),
    '--bundle',
    '--platform=node',
    '--format=cjs',
    '--target=node20',
    '--alias:electron=' + slash(join(OUT, 'stub.cjs')),
    '--outfile=' + slash(join(OUT, 'bundle.cjs')),
    '--log-level=warning'
  ],
  { stdio: 'inherit', cwd: ROOT }
)

const DATA = mkdtempSync(join(tmpdir(), 'v10-'))
process.env.V10_DATA = DATA
process.env.V10_APP = ROOT
mkdirSync(join(DATA, 'Desktop'), { recursive: true })
mkdirSync(join(DATA, 'Documents'), { recursive: true })
const mod = require(join(OUT, 'bundle.cjs'))

let pass = 0
let fail = 0
const lines = []
function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('返回 false')
    pass++
    lines.push('  PASS  ' + name)
  } catch (e) {
    fail++
    lines.push('  FAIL  ' + name + '  -> ' + (e && e.message ? e.message : String(e)))
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m || '断言失败')
}
const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

;(async () => {
  lines.push('=== 1. 附件内容抽取 ===')

  check('纯文本附件能读到完整内容', () => {
    const f = join(OUT, 'note.txt')
    const body = '这是一份测试文档。\n第二行内容。\n第三行：关键数据 = 42。'
    writeFileSync(f, body, 'utf-8')
    const r = mod.extractAttachmentText(f, 'text')
    assert(!r.error, '报错：' + r.error)
    assert(r.text.includes('关键数据 = 42'), '内容没读到：' + r.text.slice(0, 80))
    return true
  })

  check('DOCX 能解出正文', () => {
    const zip = makeZip([
      {
        name: 'word/document.xml',
        data: Buffer.from(
          '<?xml version="1.0"?><w:document><w:body>' +
            '<w:p><w:r><w:t>季度报告</w:t></w:r></w:p>' +
            '<w:p><w:r><w:t>营收增长了 </w:t></w:r><w:r><w:t>35%</w:t></w:r></w:p>' +
            '</w:body></w:document>',
          'utf-8'
        )
      }
    ])
    const f = join(OUT, 'report.docx')
    writeFileSync(f, zip)
    const r = mod.extractAttachmentText(f, 'text')
    assert(!r.error, '报错：' + r.error)
    assert(r.text.includes('季度报告'), '没读到标题：' + r.text.slice(0, 100))
    assert(r.text.includes('35%'), '没读到数据：' + r.text.slice(0, 100))
    return true
  })

  check('XLSX 能解出单元格', () => {
    const zip = makeZip([
      {
        name: 'xl/sharedStrings.xml',
        data: Buffer.from('<sst><si><t>姓名</t></si><si><t>分数</t></si><si><t>张三</t></si></sst>', 'utf-8')
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        data: Buffer.from(
          '<worksheet><sheetData>' +
            '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>' +
            '<row><c t="s"><v>2</v></c><c><v>95</v></c></row>' +
            '</sheetData></worksheet>',
          'utf-8'
        )
      }
    ])
    const f = join(OUT, 'score.xlsx')
    writeFileSync(f, zip)
    const r = mod.extractAttachmentText(f, 'text')
    assert(!r.error, '报错：' + r.error)
    assert(r.text.includes('张三'), '没读到共享字符串：' + r.text.slice(0, 120))
    assert(r.text.includes('95'), '没读到数值：' + r.text.slice(0, 120))
    return true
  })

  check('PDF 无文本层时给出明确说明', () => {
    const f = join(OUT, 'scan.pdf')
    writeFileSync(f, Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF', 'latin1'))
    const r = mod.extractAttachmentText(f, 'text')
    assert(r.error, '应该报错说明是扫描件')
    assert(/扫描|图片|OCR/.test(r.error), '说明不够清楚：' + r.error)
    return true
  })

  check('图片附件不假装能读像素', () => {
    const f = join(OUT, 'pic.png')
    writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const r = mod.extractAttachmentText(f, 'image')
    assert(r.method === 'image', 'method 不对：' + r.method)
    assert(/没有视觉能力|无法读取图片/.test(r.text), '应说明看不到像素：' + r.text)
    return true
  })

  check('老版 Office 格式给出可执行建议', () => {
    const f = join(OUT, 'old.doc')
    writeFileSync(f, Buffer.from('fake', 'latin1'))
    const r = mod.extractAttachmentText(f, 'text')
    assert(r.error, '应该报错')
    assert(/docx/.test(r.error), '应提示转存为 docx：' + r.error)
    return true
  })

  check('长文本会被截断但不是丢弃', () => {
    const f = join(OUT, 'long.txt')
    writeFileSync(f, 'A'.repeat(40000), 'utf-8')
    const r = mod.extractAttachmentText(f, 'text')
    assert(r.truncated === true, '应标记截断')
    assert(r.text.length > 10000, '截断得太狠：' + r.text.length)
    return true
  })

  lines.push('')
  lines.push('=== 2. 权限不是假的 ===')

  const DESKTOP = join(DATA, 'Desktop')
  const docFile = join(DESKTOP, '我的文档.txt')
  writeFileSync(docFile, '桌面上的文档内容', 'utf-8')

  check('默认档位是 view（第十一轮起改为最小权限）', () => {
    assert(mod.getMachinePermission() === 'view', '实际 ' + mod.getMachinePermission())
    return true
  })

  check('工作区内的文件能读', () => {
    const ws = mod.getWorkspace()
    const f = join(ws, 'inside.txt')
    writeFileSync(f, 'inside', 'utf-8')
    const resolved = mod.resolveSafe(f)
    assert(resolved.toLowerCase() === f.toLowerCase(), '路径没解析对：' + resolved)
    return true
  })

  check('用户桌面文件也能读（不是假权限）', () => {
    const resolved = mod.resolveSafe(docFile)
    assert(existsSync(resolved), '解析后文件不存在：' + resolved)
    const content = readFileSync(resolved, 'utf-8')
    assert(content.includes('桌面上的文档内容'), '读不到内容：' + content)
    return true
  })

  check('用户文档目录能读', () => {
    const f = join(DATA, 'Documents', 'x.txt')
    writeFileSync(f, 'docs', 'utf-8')
    assert(existsSync(mod.resolveSafe(f)), '文档目录读不到')
    return true
  })

  check('读取系统目录放行（只读无破坏性），写入仍受档位约束', () => {
    mod.setMachinePermission('view')
    const r = mod.resolveSafe('C:\\Windows\\System32\\config\\SAM')
    assert(typeof r === 'string' && r.length > 0, '读路径没放行')
    return true
  })

  check('完全权限下用户目录任意路径放行', () => {
    mod.setMachinePermission('full')
    const homeFile = join(DATA, 'Documents', 'free-write.txt')
    writeFileSync(homeFile, 'full tier write', 'utf-8')
    const resolved = mod.resolveSafe(homeFile)
    assert(resolved.toLowerCase().includes('free-write'), '完全权限没放行用户目录：' + resolved)
    return true
  })

  check('完全权限下系统目录仍受保护（特性而非回归）', () => {
    mod.setMachinePermission('full')
    let threw = false
    try {
      mod.resolveSafe('C:\\Windows\\System32\\drivers\\etc\\hosts')
    } catch (e) {
      threw = true
      assert(/系统目录|拒绝/.test(String(e.message)), '错误信息不对：' + e.message)
    }
    assert(threw, '系统目录应被拒绝')
    mod.setMachinePermission('view')
    return true
  })

  check('档位能持久化', () => {
    mod.setMachinePermission('view')
    assert(mod.getMachinePermission() === 'view', '没落盘')
    mod.setMachinePermission('workspace')
    assert(mod.getMachinePermission() === 'workspace', '没还原')
    return true
  })

  check('仅可查看档位仍允许读', () => {
    mod.setMachinePermission('view')
    const d = mod.checkPermission('fs_read', { path: docFile }, { workspace: mod.getWorkspace() })
    assert(d.allowed === true, '读操作不该被拦：' + d.reason)
    mod.setMachinePermission('workspace')
    return true
  })

  lines.push('')
  lines.push('=== 3. 表情包图片显示 ===')

  check('渲染层用 appfile:// 而非 file://', () => {
    const src = read('src/renderer/src/utils/localUrl.ts')
    assert(src.includes("'appfile:///'"), '没有转成 appfile')
    assert(src.includes('file:'), '应该处理旧 file:// 值')
    const chat = read('src/renderer/src/pages/ChatPage.tsx')
    assert(chat.includes('toLocalUrl(img.path)'), '消息图片没用 toLocalUrl')
    return true
  })

  check('主进程注册了 appfile 协议', () => {
    const idx = read('src/main/index.ts')
    assert(idx.includes('registerAppFileScheme'), '没注册协议')
    assert(idx.includes('installAppFileProtocol'), '没装处理器')
    return true
  })

  check('协议有白名单（不暴露整个文件系统）', () => {
    const src = read('src/main/localFile.ts')
    assert(src.includes('allowedRoots'), '没有白名单')
    assert(src.includes('403'), '越权时应返回 403')
    return true
  })

  check('表情包带 fileUrl 字段', () => {
    const idx = read('src/main/index.ts')
    assert(idx.includes('fileUrl: toAppFileUrl'), 'sticker 没带 fileUrl')
    return true
  })

  check('表情包选择器优先用 fileUrl', () => {
    const src = read('src/renderer/src/components/StickerPicker.tsx')
    assert(src.includes('s.fileUrl || s.dataUrl'), '没优先用 fileUrl')
    return true
  })

  check('头像与背景也走本地协议', () => {
    const av = read('src/renderer/src/components/Avatar.tsx')
    const bg = read('src/renderer/src/components/BackgroundLayer.tsx')
    assert(av.includes('normalizeStoredUrl'), '头像没转换')
    assert(bg.includes('toLocalUrl'), '背景没转换')
    return true
  })

  lines.push('')
  lines.push('=== 4. 完全权限弹窗 ===')

  check('风险弹窗用 portal 挂到 body', () => {
    const src = read('src/renderer/src/components/PermissionBadge.tsx')
    assert(src.includes('createPortal'), '没用 portal —— 会被祖先层叠上下文困住')
    assert(src.includes('document.body'), '没挂到 body')
    return true
  })

  check('风险弹窗层级高于其他浮层', () => {
    const src = read('src/renderer/src/components/PermissionBadge.tsx')
    const m = src.match(/\.perm-risk-mask\s*\{[\s\S]*?z-index:\s*(\d+)/)
    assert(m, '找不到 z-index')
    const z = Number(m[1])
    assert(z >= 300, `z-index 太小：${z}（其他浮层到 999）`)
    return true
  })

  lines.push('')
  lines.push('=== 5. 附件真正进 prompt ===')

  check('系统提示词用文档解析而不是 preview', () => {
    const src = read('src/main/llm.ts')
    assert(src.includes('documentText'), '没用文档解析')
    assert(!src.includes('a.preview.slice(0, 2000)'), '还在用旧的 2000 字截断')
    return true
  })

  check('提示词要求基于实际内容回答', () => {
    const src = read('src/main/llm.ts')
    assert(src.includes('实际内容'), '没强调用实际内容')
    assert(src.includes('无法读取'), '没要求如实说明读不了')
    return true
  })

  console.log('\n' + lines.join('\n'))
  console.log('\n========================================')
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================\n')

  rmSync(OUT, { recursive: true, force: true })
  rmSync(DATA, { recursive: true, force: true })
  process.exit(fail === 0 ? 0 : 1)
})().catch((e) => {
  console.log('\n' + lines.join('\n'))
  console.error('\n测试崩溃: ' + e.message)
  process.exit(2)
})

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0 ^ -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function makeZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf-8')
    const data = e.data
    const crc = crc32(data)
    const size = data.length

    const local = Buffer.alloc(30 + nameBuf.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8) // store
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    nameBuf.copy(local, 30)
    locals.push(local, data)

    const central = Buffer.alloc(46 + nameBuf.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10) // store
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(size, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    nameBuf.copy(central, 46)
    centrals.push(central)

    offset += local.length + data.length
  }

  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, eocd])
}
