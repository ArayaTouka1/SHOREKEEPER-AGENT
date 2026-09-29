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

lines.push('=== 关闭行为（静默静态验证） ===')

check('三种关闭选项齐全（询问/最小化/退出）', () => {
  const src = read('src/shared/channels.ts') + read('src/renderer/src/types/global.d.ts')
  assert(src.includes("'ask'"), '没有 ask')
  assert(src.includes("'minimize'"), '没有 minimize')
  assert(src.includes("'quit'"), '没有 quit')
  return true
})

check('「不再显示关闭确认」开关存在', () => {
  const src = read('src/renderer/src/types/global.d.ts')
  assert(src.includes('askDisabled'), '没有 askDisabled')
  return true
})

check('关闭行为落盘接口存在', () => {
  const src = read('src/shared/channels.ts')
  assert(src.includes('windowSetClosePref'), '没有 setClosePref 通道')
  return true
})

console.log('\n' + lines.join('\n'))
console.log('\n========================================')
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('========================================\n')
process.exit(fail === 0 ? 0 : 1)
