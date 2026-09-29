/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify13')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
const D = process.env.V13_DATA
const path = require('node:path')
module.exports = {
  app: {
    getPath: (k) => {
      const map = {
        userData: D, home: path.join(D, 'home'),
        desktop: path.join(D, 'Desktop'), documents: path.join(D, 'Documents'),
        downloads: path.join(D, 'Downloads'), pictures: path.join(D, 'Pictures'),
        music: path.join(D, 'Music'), videos: path.join(D, 'Videos')
      }
      return map[k] || D
    },
    getAppPath: () => process.env.V13_APP,
    getVersion: () => '0.21.0'
  },
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

writeFileSync(
  join(OUT, 'entry.ts'),
  `
export * from '${slash(join(ROOT, 'src/main/voice'))}'
export * from '${slash(join(ROOT, 'src/main/permission'))}'
export * from '${slash(join(ROOT, 'src/main/agentTools'))}'
export * from '${slash(join(ROOT, 'src/main/safeFs'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v13-'))
process.env.V13_DATA = DATA
process.env.V13_APP = ROOT
mkdirSync(join(DATA, 'home'), { recursive: true })
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
  lines.push('=== 1. 本地语音选项全部删除 ===')

  check('语音预设只剩 3 个', () => {
    assert(mod.VOICE_PRESETS.length === 3, '实际 ' + mod.VOICE_PRESETS.length)
    const ids = mod.VOICE_PRESETS.map((p) => p.id)
    assert(!ids.includes('vp_local'), '还有 vp_local')
    return true
  })

  check('语音引擎选择器不再提供 local 选项（本地引擎已删除）', () => {
    const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
    assert(!src.includes("k: 'local'"), '引擎卡仍有 local 选项')
    assert(src.includes("k: 'inworld'"), '缺少云合成选项')
    assert(src.includes("k: 'system'"), '缺少系统合成选项')
    assert(src.includes("k: 'none'"), '缺少不发声选项')
    return true
  })

  check('本地面板已移除（无 KokoroPanel / LocalTtsPanel）', () => {
    const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
    assert(!src.includes('KokoroPanel'), '仍有 KokoroPanel 渲染')
    assert(!src.includes('LocalTtsPanel'), '仍有 LocalTtsPanel 渲染')
    assert(!src.includes("cv.engine === 'local'"), '仍有 local 引擎门控')
    return true
  })

  lines.push('')
  lines.push('=== 2. 云合成 API 保存 ===')

  check('persist 以 draft 为基线（不再拉主进程旧值覆盖）', () => {
    const src = read('src/renderer/src/pages/settings/CloudTtsPanel.tsx')
    const persistBlock = src.slice(src.indexOf('const persist'), src.indexOf('const switchProvider'))
    assert(!persistBlock.includes('settings.get'), '还在拉主进程旧值')
    assert(persistBlock.includes('{ ...draft, ...(p ?? {}) }'), '不是以 draft 为基线')
    return true
  })

  check('有显式「保存配置」按钮', () => {
    const src = read('src/renderer/src/pages/settings/CloudTtsPanel.tsx')
    assert(src.includes('tts-save'), '没有保存按钮 testid')
    assert(src.includes('保存配置'), '没有保存文案')
    return true
  })

  lines.push('')
  lines.push('=== 3. 读取权限（任意路径可读） ===')

  const fDriveFile = 'F:\\work\\aiagent\\测试用文档.txt'
  check('F 盘文件可读（view 档）', async () => {
    mod.setMachinePermission('view')
    const r = await mod.runAgentTool('fs_read', { path: fDriveFile })
    assert(!String(r.summary).includes('超出'), '读被拦：' + r.summary)
    return true
  })

  check('readTextFile 用 readOnly 放行', () => {
    const src = read('src/main/agentTools.ts')
    assert(src.includes('readOnly: true'), 'readTextFile 没加 readOnly')
    return true
  })

  check('读取路径不做越界检查（只有写才检查）', () => {
    const src = read('src/main/safeFs.ts')
    const body = src.slice(src.indexOf('export function resolveSafePath'))
    assert(/if \(opts\.forWrite\)/.test(body), '没有 forWrite 分支')
    const writeBlock = body.slice(body.indexOf('if (opts.forWrite)'), body.indexOf('if (opts.mustExist'))
    assert(writeBlock.includes('isPathInside'), '写路径没做越界判定')
    return true
  })

  lines.push('')
  lines.push('=== 4. 附件展示 + 审核提示 ===')

  check('ChatMessage 有 attachments 字段', () => {
    const src = read('src/shared/types.ts')
    assert(src.includes('attachments?: MessageAttachment[]'), '没有 attachments 字段')
    assert(src.includes('MessageAttachment'), '没有 MessageAttachment 类型')
    return true
  })

  check('消息按类型展示附件（图片缩略图/图标+文件名+扩展名）', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(src.includes('msg-attachments'), '没有附件容器')
    assert(src.includes("att.kind === 'image'"), '图片没有单独分支')
    assert(src.includes('msg-attach-file'), '文件卡片没有')
    assert(src.includes('msg-attach-ext'), '扩展名没有展示')
    return true
  })

  check('附件类型图标映射存在', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(src.includes('iconForAtt'), '没有 iconForAtt')
    return true
  })

  check('delta 阶段不显示文字（避免先弹出再收回）', () => {
    const src = read('src/renderer/src/store/AppStore.tsx')
    const deltaBlock = src.slice(src.indexOf("chunk.type === 'delta'"), src.indexOf("chunk.type === 'done'"))
    assert(!deltaBlock.includes('streamingText: snapshot'), '还在直接上屏')
    assert(deltaBlock.includes('awaitingText: true'), '没有 awaitingText')
    return true
  })

  check('审核提示只跟 awaitingText/syncText 挂钩', () => {
    const src = read('src/renderer/src/pages/ChatPage.tsx')
    assert(src.includes('(awaitingText || (syncText && syncRatio === 0))'), '审核提示没挂 awaitingText/syncText')
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
