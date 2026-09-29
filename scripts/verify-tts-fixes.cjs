/**
 *
 */

const { join, resolve } = require('node:path')
const fs = require('node:fs')

const ROOT = resolve(__dirname, '..')
const read = (p) => fs.readFileSync(join(ROOT, p), 'utf-8')

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

lines.push('=== A. 云合成 ===')

check('云合成支持三种协议（Inworld/OpenAI 兼容/自定义）', () => {
  const src = read('src/renderer/src/pages/settings/CloudTtsPanel.tsx')
  assert(src.includes("k: 'inworld'"), '没有 Inworld')
  assert(src.includes("k: 'openai-compatible'"), '没有 OpenAI 兼容')
  assert(src.includes("k: 'custom'"), '没有自定义')
  return true
})

check('API Key 保存以 draft 为基线（修复保存 bug）', () => {
  const src = read('src/renderer/src/pages/settings/CloudTtsPanel.tsx')
  const persistBlock = src.slice(src.indexOf('const persist'), src.indexOf('const switchProvider'))
  assert(!persistBlock.includes('settings.get'), '还在拉主进程旧值覆盖 draft')
  return true
})

check('有显式「保存配置」按钮', () => {
  const src = read('src/renderer/src/pages/settings/CloudTtsPanel.tsx')
  assert(src.includes('tts-save'), '没有保存按钮')
  return true
})

lines.push('')
lines.push('=== B. 本地语音生成引擎已删除 ===')

check('语音引擎不再提供 local 选项', () => {
  const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
  assert(!src.includes("k: 'local'"), '引擎卡仍有 local 选项')
  assert(src.includes("k: 'inworld'"), '缺云合成选项')
  assert(src.includes("k: 'system'"), '缺系统合成选项')
  assert(src.includes("k: 'none'"), '缺不发声选项')
  return true
})

check('本地面板已移除', () => {
  const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
  assert(!src.includes('KokoroPanel'), '仍有 KokoroPanel')
  assert(!src.includes('LocalTtsPanel'), '仍有 LocalTtsPanel')
  assert(!src.includes("cv.engine === 'local'"), '仍有 local 引擎门控')
  return true
})

check('语音预设无 vp_local', () => {
  const src = read('src/main/voice.ts')
  assert(!src.includes("id: 'vp_local'"), '还有 vp_local 预设')
  return true
})

lines.push('')
lines.push('=== C. 试听按钮 ===')

check('试听按钮仍存在（系统合成/云合成朗读）', () => {
  const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
  assert(src.includes('voice-preview'), '没有试听按钮 testid')
  assert(src.includes('▶ 按当前设置朗读'), '没有试听文案')
  return true
})

check('云合成 API 断开连接入口存在', () => {
  const src = read('src/renderer/src/pages/settings/CloudTtsPanel.tsx')
  assert(src.includes('tts-disconnect'), '没有断开按钮')
  return true
})

console.log('\n' + lines.join('\n'))
console.log('\n========================================')
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('========================================\n')
process.exit(fail === 0 ? 0 : 1)
