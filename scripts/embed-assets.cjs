/**
 *
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const FFMPEG = 'C:\\Users\\Administrator\\.dsh-wallpaper-engine\\ffmpeg\\ffmpeg.exe'
const ROOT = path.resolve(__dirname, '..')
const SRC_DIR = 'F:\\work\\aiagent'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-'))

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const IMAGES = [
  { src: '守岸人.png', key: 'shorekeeperAvatar', size: 512, desc: '守岸人头像' },
  { src: '爱弥斯.png', key: 'aemeathAvatar', size: 512, desc: '爱弥斯头像' },
  { src: '流萤.png', key: 'fireflyAvatar', size: 512, desc: '流萤头像' },
  { src: '守岸人.png', key: 'shorekeeperBanner', size: 900, desc: '守岸人头图', banner: true },
  { src: '爱弥斯.png', key: 'aemeathBanner', size: 900, desc: '爱弥斯头图', banner: true },
  { src: '流萤.png', key: 'fireflyBanner', size: 900, desc: '流萤头图', banner: true },
  { src: '克罗艾.png', key: 'chloeAvatar', size: 512, desc: '嘉神川克罗艾头像' },
  { src: '克罗艾.png', key: 'chloeBanner', size: 900, desc: '嘉神川克罗艾头图', banner: true }
]

function convertImage(src, out, size, banner) {
  const vf = banner
    ? `scale=${size}:-1:flags=lanczos,crop=${size}:min(ih\\,${Math.round(size / 2.4)}):0:0`
    : `scale=${size}:${size}:flags=lanczos:force_original_aspect_ratio=increase,crop=${size}:${size}`
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-vf', vf]
  if (banner) args.push('-q:v', '6')
  else args.push('-pix_fmt', 'rgba', '-compression_level', '9')
  args.push('-frames:v', '1', out)
  execFileSync(FFMPEG, args, { stdio: 'inherit' })
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const VOICES = [
  { src: '守岸人语音.mp3', key: 'shorekeeperVoice', seconds: 24, desc: '守岸人默认音色' },
  { src: '爱弥斯.mp3', key: 'aemeathVoice', seconds: 24, desc: '爱弥斯默认音色' },
  { src: '流萤.mp3', key: 'fireflyVoice', seconds: 24, desc: '流萤默认音色' },
  { src: '守岸人语音.mp3', key: 'chloeVoice', seconds: 24, desc: '嘉神川克罗艾默认音色（占位，可在界面更换）' }
]

const VOICE_OUT_DIR = path.join(ROOT, 'resources', 'voices')

function convertVoice(src, out, seconds) {
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-t', String(seconds), '-ac', '1', '-ar', '24000', '-b:a', '40k', '-f', 'mp3', out],
    { stdio: 'inherit' }
  )
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

const parts = [
  '/**',
  ' * 内置角色资源（自动生成，请勿手改）',
  ' * 由 scripts/embed-assets.cjs 从 F:\\work\\aiagent 下的素材生成。',
  ' * 图片以 data-URI 内联，保证打包成 asar 后仍可直接渲染；',
  ' * 语音以文件形式放在 resources/voices，运行时按路径播放。',
  ' */',
  ''
]

fs.mkdirSync(VOICE_OUT_DIR, { recursive: true })

for (const img of IMAGES) {
  const src = path.join(SRC_DIR, img.src)
  if (!fs.existsSync(src)) {
    console.error('跳过（找不到源图）: ' + src)
    continue
  }
  const ext = img.banner ? 'jpg' : 'png'
  const out = path.join(TMP, img.key + '.' + ext)
  convertImage(src, out, img.size, img.banner)
  const b64 = fs.readFileSync(out).toString('base64')
  const mime = img.banner ? 'image/jpeg' : 'image/png'
  parts.push(`/** ${img.desc} —— 源: ${img.src} */`)
  parts.push(`export const ${img.key} = 'data:${mime};base64,${b64}'`)
  parts.push('')
  console.log(`${img.key}: ${img.size}px ${mime}, ${(b64.length / 1024).toFixed(0)} KB`)
}

parts.push('/**')
parts.push(' * 语音文件名（相对 resources/voices）。')
parts.push(' * 运行时由主进程拼成绝对路径播放。')
parts.push(' */')
parts.push('export const VOICE_FILES = {')
for (const v of VOICES) {
  const src = path.join(SRC_DIR, v.src)
  if (!fs.existsSync(src)) {
    console.error('跳过（找不到音频）: ' + src)
    continue
  }
  const outName = v.key + '.mp3'
  convertVoice(src, path.join(VOICE_OUT_DIR, outName), v.seconds)
  const kb = (fs.statSync(path.join(VOICE_OUT_DIR, outName)).size / 1024).toFixed(0)
  parts.push(`  /** ${v.desc} —— 源: ${v.src}，截取前 ${v.seconds}s */`)
  parts.push(`  ${v.key}: '${outName}',`)
  console.log(`${v.key}: ${outName}, ${kb} KB`)
}
parts.push('} as const')
parts.push('')
parts.push('export type VoiceFileKey = keyof typeof VOICE_FILES')
parts.push('')

fs.writeFileSync(path.join(ROOT, 'src', 'main', 'assets.ts'), parts.join('\n'), 'utf-8')
fs.rmSync(TMP, { recursive: true, force: true })

const size = fs.statSync(path.join(ROOT, 'src', 'main', 'assets.ts')).size
console.log('\n已写入 src/main/assets.ts (' + (size / 1024).toFixed(0) + ' KB)')
console.log('语音目录: ' + VOICE_OUT_DIR)
