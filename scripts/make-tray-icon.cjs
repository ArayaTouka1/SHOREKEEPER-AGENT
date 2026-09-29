/**
 *
 */

const { readFileSync, writeFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const src = join(ROOT, 'build', 'tray32.png')
const out = join(ROOT, 'src', 'main', 'trayIcon.ts')

if (!existsSync(src)) {
  console.error('找不到 build/tray32.png，请先用 ffmpeg 生成：')
  console.error('  ffmpeg -i 守岸人.png -vf "scale=32:32:flags=lanczos" build/tray32.png')
  process.exit(1)
}

const b64 = readFileSync(src).toString('base64')

const content = `/**
 *
 */

export const TRAY_ICON_BASE64 = '${b64}'

export const TRAY_ICON_DATA_URL = 'data:image/png;base64,' + TRAY_ICON_BASE64
`

writeFileSync(out, content, 'utf-8')
console.log(`已生成 ${out}（${b64.length} 字符 base64，源文件 ${readFileSync(src).length} 字节）`)
