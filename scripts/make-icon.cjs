/**
 *
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const FFMPEG = 'C:\\Users\\Administrator\\.dsh-wallpaper-engine\\ffmpeg\\ffmpeg.exe'
const SRC = process.argv[2] || 'F:\\work\\aiagent\\守岸人.png'
const OUT_DIR = path.resolve(__dirname, '..', 'build')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-'))

const ICO_SIZES = [256, 128, 64, 48, 32, 16]


function encodeICO(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)

  const entries = []
  let offset = 6 + 16 * pngs.length
  for (const p of pngs) {
    const e = Buffer.alloc(16)
    e[0] = p.size >= 256 ? 0 : p.size
    e[1] = p.size >= 256 ? 0 : p.size
    e[2] = 0
    e[3] = 0
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(p.data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += p.data.length
    entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}


function resize(src, size, out) {
  execFileSync(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      src,
      '-vf',
      `scale=${size}:${size}:flags=lanczos:force_original_aspect_ratio=increase,crop=${size}:${size}`,
      '-pix_fmt',
      'rgba',
      out
    ],
    { stdio: 'inherit' }
  )
}


if (!fs.existsSync(SRC)) {
  console.error('找不到源图: ' + SRC)
  process.exit(1)
}
if (!fs.existsSync(FFMPEG)) {
  console.error('找不到 ffmpeg: ' + FFMPEG)
  process.exit(1)
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const mainPng = path.join(OUT_DIR, 'icon.png')
resize(SRC, 512, mainPng)

const pngs = ICO_SIZES.map((size) => {
  const tmp = path.join(TMP, `${size}.png`)
  resize(SRC, size, tmp)
  return { size, data: fs.readFileSync(tmp) }
})
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), encodeICO(pngs))

fs.rmSync(TMP, { recursive: true, force: true })

console.log('源图      : ' + SRC)
console.log('icon.png  : ' + fs.statSync(mainPng).size + ' bytes (512x512)')
console.log('icon.ico  : ' + fs.statSync(path.join(OUT_DIR, 'icon.ico')).size + ' bytes (' + ICO_SIZES.join('/') + ')')
