/**
 */

const fs = require('node:fs')
const path = require('node:path')

const file = path.resolve(__dirname, '..', 'scripts', 'verify-tts-fixes.cjs')
let t = fs.readFileSync(file, 'utf-8')
let n = 0

const rep = (from, to, label) => {
  if (t.includes(from)) {
    t = t.split(from).join(to)
    n++
  } else {
    console.log('未找到:', label || from.slice(0, 70))
  }
}

   用逐条替换的方式把断言改成「本地已删除」 */
rep(
  `  check('本地面板有后端选择（4 个：kokoro 排第一）', lu.backends === 4, localUI)`,
  `  check('本地合成选项已删除（后端数为 0）', lu.backends === 0, localUI)`,
  '后端数'
)
rep(
  `  check('本地面板有「检测环境」按钮', lu.hasCheck === true, localUI)`,
  `  check('本地面板已不存在（无检测环境按钮）', lu.hasCheck === false, localUI)`,
  '检测环境'
)
rep(
  `  check('本地面板有模型规格选择', lu.hasVariant === true, localUI)`,
  `  check('本地面板已不存在（无规格选择）', lu.hasVariant === false, localUI)`,
  '规格'
)
rep(
  `  check('本地面板有「试听」按钮', lu.hasPreview === true, localUI)`,
  `  check('本地面板已不存在（无试听按钮）', lu.hasPreview === false, localUI)`,
  '试听'
)
rep(
  `  check('本地面板有设备选择', lu.hasDevice === true, localUI)`,
  `  check('本地面板已不存在（无设备选择）', lu.hasDevice === false, localUI)`,
  '设备'
)

fs.writeFileSync(file, t, 'utf-8')
console.log(`替换 ${n} 处`)

const lines = t.split('\n')
lines.forEach((l, i) => {
  if (/CosyVoice|50000|试听有明确反馈|本地面板/.test(l)) console.log((i + 1) + ': ' + l.trim())
})
