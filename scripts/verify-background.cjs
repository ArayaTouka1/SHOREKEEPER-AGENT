/**
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

lines.push('=== 背景媒体链路（静默静态验证） ===')

check('背景渲染走 appfile 协议', () => {
  const src = read('src/renderer/src/components/BackgroundLayer.tsx')
  assert(src.includes('toLocalUrl'), '背景没用 toLocalUrl')
  return true
})

check('背景图/视频有播放控制', () => {
  const src = read('src/renderer/src/components/BackgroundLayer.tsx')
  assert(src.includes('playbackRate'), '没有播放速率')
  assert(src.includes('loop'), '没有循环')
  return true
})

check('appfile 协议白名单存在', () => {
  const src = read('src/main/localFile.ts')
  assert(src.includes('allowedRoots'), '没有白名单')
  assert(src.includes('allowFile'), '没有单文件放行')
  return true
})

check('用户选文件后放行（bgPatch 走 allowFile）', () => {
  const src = read('src/main/index.ts')
  assert(src.includes('CH.bgPatch'), '没有 bgPatch handler')
  assert(src.includes('allowFile'), '没引入 allowFile')
  return true
})

check('支持减少动效', () => {
  const css = read('src/renderer/src/styles/global.css')
  assert(css.includes('prefers-reduced-motion'), '没有 reduced-motion')
  return true
})

console.log('\n' + lines.join('\n'))
console.log('\n========================================')
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('========================================\n')
process.exit(fail === 0 ? 0 : 1)
