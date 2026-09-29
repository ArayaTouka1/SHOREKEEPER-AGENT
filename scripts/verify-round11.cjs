/**
 *
 *
 */

const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')

const ROOT = resolve(__dirname, '..')
const OUT = join(ROOT, '.verify11')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const slash = (p) => p.replace(/\\/g, '/')

writeFileSync(
  join(OUT, 'stub.cjs'),
  `
const D = process.env.V11_DATA
module.exports = {
  app: { getPath: () => D, getAppPath: () => process.env.V11_APP, getVersion: () => '0.21.0' },
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
export * from '${slash(join(ROOT, 'src/main/settings'))}'
export * from '${slash(join(ROOT, 'src/main/permission'))}'
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

const DATA = mkdtempSync(join(tmpdir(), 'v11-'))
process.env.V11_DATA = DATA
process.env.V11_APP = ROOT
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

lines.push('=== 1. 权限默认「仅可查看」 ===')

check('默认档位是 view', () => {
  assert(mod.getMachinePermission() === 'view', '实际 ' + mod.getMachinePermission())
  return true
})

check('settings.ts 默认值是 view', () => {
  const src = read('src/main/settings.ts')
  assert(src.includes("machinePermission: 'view'"), '默认值不是 view')
  return true
})

check('view 档写操作被拒', () => {
  const d = mod.checkPermission('fs_write', { path: 'x' }, { workspace: 'C:\\w' })
  assert(d.allowed === false, '写操作不该放行')
  assert(/仅可查看/.test(d.reason), '原因没提档位：' + d.reason)
  return true
})

check('view 档执行命令被拒', () => {
  const d = mod.checkPermission('shell_run', {}, { workspace: 'C:\\w' })
  assert(d.allowed === false, '执行不该放行')
  return true
})

check('view 档读操作放行', () => {
  const d = mod.checkPermission('fs_read', { path: 'x' }, { workspace: 'C:\\w' })
  assert(d.allowed === true, '读应该放行')
  return true
})

lines.push('')
lines.push('=== 2. 版本号（语义化） ===')

check('package.json 版本是合法的语义化版本', () => {
  const j = JSON.parse(read('package.json'))
  assert(/^\d+\.\d+\.\d+$/.test(j.version), '不是语义化版本：' + j.version)
  return true
})

lines.push('')
lines.push('=== 3. 设置内删除关于/诊断与日志 ===')

check('设置页无「关于」分页', () => {
  const src = read('src/renderer/src/pages/SettingsPage.tsx')
  assert(!src.includes("label: '关于'"), '还有关于分页')
  assert(!src.includes("label: '诊断与日志'"), '还有诊断分页')
  assert(!/function (AboutSection|DiagnosticsSection)/.test(src), '函数定义还在')
  return true
})

check('分页数从 13 减到 11', () => {
  const src = read('src/renderer/src/pages/SettingsPage.tsx')
  const i = src.indexOf('const SECTIONS')
  const j = src.indexOf(']', i)
  const block = src.slice(i, j)
  const keys = [...block.matchAll(/\{ key: '([a-z]+)', label: '([^']+)'/g)]
  assert(keys.length === 11, `实际 ${keys.length} 个分页`)
  const labels = keys.map((m) => m[2])
  assert(!labels.includes('关于'), '还有关于分页')
  assert(!labels.includes('诊断与日志'), '还有诊断分页')
  return true
})

lines.push('')
lines.push('=== 4. 设置底部版权声明 ===')

check('设置底部有版权声明', () => {
  const src = read('src/renderer/src/pages/SettingsPage.tsx')
  assert(src.includes('settings-notice'), '没有版权声明节点')
  assert(src.includes('守岸人是《鸣潮》的角色'), '缺少鸣潮版权句')
  assert(src.includes('版权归库洛游戏所有'), '缺少库洛游戏')
  assert(src.includes('非官方同人作品'), '缺少非官方声明')
  assert(src.includes('禁止任何倒卖行为'), '缺少禁止倒卖')
  return true
})

check('声明固定在内容下方（flex-shrink:0）', () => {
  const src = read('src/renderer/src/pages/SettingsPage.tsx')
  assert(/\.settings-notice\s*\{[\s\S]*?flex-shrink:\s*0/.test(src), '没有固定定位样式')
  return true
})

lines.push('')
lines.push('=== 5. 首页快捷指令删除 ===')

check('首页无快捷指令卡片', () => {
  const src = read('src/renderer/src/pages/HomePage.tsx')
  assert(!/title="快捷指令"/.test(src), '还有快捷指令块')
  assert(!src.includes('home-quick'), '还有快捷指令 testid')
  return true
})

lines.push('')
lines.push('=== 6. 页面与内容过渡 ===')

check('页面切换有入场动画', () => {
  const css = read('src/renderer/src/styles/global.css')
  assert(css.includes('route-fade'), '没有 route-fade 动画')
  assert(/\.main-area\s*\{[\s\S]*?animation: route-fade/.test(css), 'main-area 没挂动画')
  return true
})

check('App.tsx 按路由重建页面（触发动画）', () => {
  const src = read('src/renderer/src/App.tsx')
  assert(src.includes('key={route}'), '没加 key={route}')
  return true
})

check('内容块有入场过渡', () => {
  const css = read('src/renderer/src/styles/global.css')
  assert(css.includes('content-rise'), '没有 content-rise 动画')
  assert(/\.card,\s*\.collapsible\s*\{[\s\S]*?animation: content-rise/.test(css), '卡片没挂动画')
  return true
})

check('支持减少动效设置', () => {
  const css = read('src/renderer/src/styles/global.css')
  assert(css.includes('prefers-reduced-motion'), '没有 reduced-motion 兜底')
  return true
})

lines.push('')
lines.push('=== 7. 当前目标卡片可完全隐藏 ===')

check('有「隐藏」按钮（完全隐藏）', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes('goal-hide'), '没有隐藏按钮')
  assert(src.includes('goalVisible'), '没有可见性状态')
  return true
})

check('右上角有圆形模块可调回（goal-fab）', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes('goal-fab'), '没有圆形模块')
  const css = read('src/renderer/src/styles/global.css')
  assert(/.goal-fab\s*\{/.test(css), '没有 goal-fab 样式')
  assert(css.includes('border-radius: 50%'), '不是圆形')
  assert(css.includes('position: absolute'), '不是悬浮定位')
  return true
})

check('目标卡片上的 PermissionBadge 已删', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  const goalSection = src.slice(src.indexOf('data-testid="goal-toggle"'), src.indexOf('data-testid="goal-body"'))
  assert(!goalSection.includes('PermissionBadge compact'), '目标卡片上还有权限按钮')
  const composerSection = src.slice(src.indexOf('chat-send'))
  assert(composerSection.includes('<PermissionBadge />'), '输入栏旁的权限按钮没了')
  return true
})

lines.push('')
lines.push('=== 8. 审核提示 + 语音同步显示 ===')

check('有「泰提斯系统审核中」提示', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes('信息由泰提斯系统审核中'), '没有审核提示文案')
  assert(src.includes('tethys-divider'), '没有居中分隔线样式节点')
  return true
})

check('store 有同步显示状态', () => {
  const src = read('src/renderer/src/store/AppStore.tsx')
  assert(src.includes('syncText'), '没有 syncText')
  assert(src.includes('syncRatio'), '没有 syncRatio')
  assert(src.includes('setSyncRatio'), '没有 setSyncRatio')
  return true
})

check('done 后立即显示全文（气泡零等待）', () => {
  const src = read('src/renderer/src/store/AppStore.tsx')
  const doneBlock = src.slice(src.indexOf("chunk.type === 'done'"), src.indexOf("chunk.type === 'error'"))
  assert(doneBlock.includes('syncText: spoken'), 'done 分支没设置 syncText')
  assert(doneBlock.includes('syncRatio: 1'), 'done 分支没有立即显示全文（syncRatio 应为 1）')
  return true
})

check('文字按语音进度截取（不切半中文）', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes('sliceByRatio'), '没有 sliceByRatio')
  assert(src.includes('[...text]'), '没有按字符数组切（会切半中文）')
  return true
})

check('同步气泡存在', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes('sync-bubble'), '没有同步气泡 testid')
  return true
})

check('语音有播放进度回调', () => {
  const src = read('src/renderer/src/hooks/useSpeech.ts')
  assert(src.includes('onProgress'), 'useSpeech 没有 onProgress')
  assert(src.includes('ontimeupdate'), 'Audio 没挂 timeupdate')
  return true
})

check('进度回调驱动文字比例', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  const ok =
    src.includes('onProgress((p) => setSyncRatio(p))') ||
    /onProgress\(\(p\) => \{[\s\S]{0,80}?setSyncRatio\(p\)/.test(src)
  assert(ok, '进度没接进 store')
  return true
})

check('同步期间隐藏完整气泡避免重复', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  const visBlock = src.slice(src.indexOf('const visible = useMemo'), src.indexOf('const pendingTool'))
  assert(visBlock.includes('syncText'), 'visible 没考虑 syncText')
  assert(visBlock.includes('lastIndexOf'), '没有找最后一条角色消息')
  return true
})

check('语音关闭/静音时直接显示全文', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes("mode === 'off'"), '没处理语音关闭')
  return true
})

check('语音逐字同步时有「仅查看文字」退路', () => {
  const src = read('src/renderer/src/pages/ChatPage.tsx')
  assert(src.includes('showFallback'), '没有 fallback 状态')
  assert(src.includes('3000'), '没有兜底定时')
  return true
})

lines.push('')
lines.push('=== 9. 本地语音生成引擎已删除 ===')

check('本地引擎模块全部删除', () => {
  for (const f of ['kokoroTts.ts', 'kokoro-worker.cjs', 'qwen3Tts.ts', 'qwenLunar.ts', 'localTts.ts', 'localTtsService.ts', 'ttsEngine.ts']) {
    assert(!existsSync(join(ROOT, 'src/main', f)), f + ' 仍存在')
  }
  return true
})

check('本地面板全部删除', () => {
  for (const f of ['KokoroPanel.tsx', 'LocalTtsPanel.tsx', 'QwenOneClickDeploy.tsx']) {
    assert(!existsSync(join(ROOT, 'src/renderer/src/pages/settings', f)), f + ' 仍存在')
  }
  return true
})

check('参考音色仍随包分发（4 个角色 + 索引）', () => {
  const dir = join(ROOT, 'resources/qwen3voices')
  assert(existsSync(join(dir, 'voices.json')), '没有 voices.json')
  const idx = JSON.parse(readFileSync(join(dir, 'voices.json'), 'utf-8'))
  assert(Array.isArray(idx.voices) && idx.voices.length === 4, '音色数不对：' + (idx.voices || []).length)
  return true
})

check('channels 不再暴露本地引擎通道', () => {
  const ch = read('src/shared/channels.ts')
  assert(!ch.includes('ttsServiceStatus'), 'channels 仍有 ttsServiceStatus')
  assert(!ch.includes('kokoroStatus'), 'channels 仍有 kokoroStatus')
  assert(!ch.includes('qwen3Synthesize'), 'channels 仍有 qwen3Synthesize')
  return true
})

check('useSpeech 无本地合成分支', () => {
  const src = read('src/renderer/src/hooks/useSpeech.ts')
  assert(!src.includes('speakLocal'), '仍有 speakLocal')
  assert(!src.includes('kokoro'), '仍有 kokoro')
  assert(src.includes('playPack'), '缺少语音包播放')
  assert(src.includes('speakInworld'), '缺少 inworld 合成')
  assert(src.includes('speakSynth'), '缺少系统合成')
  return true
})

check('打包配置不再分发本地引擎资源', () => {
  const yml = read('electron-builder.yml')
  assert(!yml.includes('resources/sherpa-onnx'), '仍分发 sherpa-onnx')
  assert(!yml.includes('resources/kokoro'), '仍分发 kokoro')
  return true
})

console.log('\n' + lines.join('\n'))
console.log('\n========================================')
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('========================================\n')

rmSync(OUT, { recursive: true, force: true })
rmSync(DATA, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
