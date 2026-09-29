/**
 *
 *
 *
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const FF = 'C:\\Users\\Administrator\\.dsh-wallpaper-engine\\ffmpeg\\ffmpeg.exe'
const SRC = 'C:\\Users\\Administrator\\Desktop\\视频剪辑.mp4'
const BGM1 = 'F:\\work\\aiagent\\千里星寻 - 漂泊的终点(守岸人主题钢琴曲)-1.3鸣潮OST★★.mp3'
const BGM2 = 'F:\\work\\aiagent\\知更鸟,HOYO-MiX,Chevy - 使一颗心免于哀伤.mp3'
const OUTDIR = 'F:\\work\\aiagent\\output'
const FONT = 'C\\:/Windows/Fonts/msyhbd.ttc'
const DRY = process.argv.includes('--dry')

const W = 1920
const H = 1080
const FPS = 30

/* ------------------------------------------------------------------ *
 *
 * ------------------------------------------------------------------ */

const SEGMENTS = [
  {
    src: [0, 3.4],
    line: '守岸人陪伴终端',
    sub: '一个住在你电脑里的 AI 伴侣',
    bgm: 1
  },
  {
    src: [4.5, 10],
    line: '打开它，她会跟你打招呼',
    bgm: 1
  },
  {
    src: [34, 44],
    line: '「你是怎么诞生的」',
    sub: '她的回答不是模板',
    bgm: 1
  },
  {
    src: [58, 68],
    line: '「看下我的电脑状态」',
    sub: 'CPU、内存、显卡，直接读给你',
    bgm: 1
  },
  {
    src: [74, 84],
    line: '需要你的允许',
    sub: '点「允许一次」才会真的执行',
    bgm: 1
  },
  {
    src: [92, 100],
    line: '读硬件免授权，动电脑要先问你',
    bgm: 1
  },
  {
    src: [100, 110],
    line: '不止守岸人 —— 还能换成别的角色',
    sub: '这些都是我自己比较喜欢的角色',
    bgm: 1,
    fadeOut: true
  },

  {
    src: [110, 122],
    line: '流萤 · 开拓者',
    sub: '温柔安静，句子偏短',
    bgm: 2
  },
  {
    src: [136, 148],
    line: '嘉神川克罗艾 · 学弟',
    sub: '凛娇自信，偶尔捉弄你一下',
    bgm: 2
  },
  {
    src: [172, 182],
    line: '角色、人格、音色，会一起换',
    bgm: 2
  },
  {
    src: [216, 226],
    line: '每个人格都是完整的一份',
    sub: '四五千字设定 + 十条世界观',
    bgm: 2
  },
  {
    src: [290, 300],
    line: '声音也能换',
    sub: '克隆音色、角色原声、本地合成',
    bgm: 2
  },
  {
    src: [356, 366],
    line: '数据全在本机，不预置任何密钥',
    bgm: 2
  },
  {
    src: [373, 381],
    line: '守岸人陪伴终端',
    sub: '装在你自己的电脑上',
    bgm: 2,
    fadeOut: true
  }
]



const SUB_STYLE = [
  `fontfile='${FONT}'`,
  'fontsize=46',
  'fontcolor=white',
  'borderw=3',
  'bordercolor=black@0.85',
  'box=1',
  'boxcolor=black@0.42',
  'boxborderw=22',
  'x=(w-text_w)/2',
  'y=h-text_h-72',
  'line_spacing=10'
].join(':')

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function fmtT(sec) {
  const m = Math.floor(sec / 60)
  const s = (sec % 60).toFixed(1)
  return `${String(m).padStart(2, '0')}:${s.padStart(4, '0')}`
}

function escText(s) {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function run(args, label) {
  try {
    execFileSync(FF, args, { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
    return true
  } catch (e) {
    const err = String(e.stderr || '')
    console.error(`  ✗ ${label} 失败`)
    console.error('    ' + err.split('\n').slice(-6).join('\n    '))
    return false
  }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

let cursor = 0
console.log('\n================ 分镜表 ================\n')
console.log('  #  素材区间        成片区间        字幕')
console.log('  ' + '─'.repeat(92))

const timeline = []
for (const seg of SEGMENTS) {
  const dur = seg.src[1] - seg.src[0]
  const start = cursor
  const end = cursor + dur
  timeline.push({ ...seg, start, end, dur })
  cursor = end
  console.log(
    `  ${String(timeline.length).padStart(2)}  ${fmtT(seg.src[0])}–${fmtT(seg.src[1])}   ` +
      `${fmtT(start)}–${fmtT(end)}   ${seg.line}`
  )
}

const total = cursor
const bgm1End = timeline.filter((t) => t.bgm === 1).reduce((a, b) => a + b.dur, 0)
console.log('  ' + '─'.repeat(92))
console.log(`\n  总时长: ${fmtT(total)} （${total.toFixed(1)} 秒）`)
console.log(`  前段 BGM 覆盖: 0 – ${fmtT(bgm1End)}`)
console.log(`  后段 BGM 覆盖: ${fmtT(bgm1End)} – ${fmtT(total)}`)
console.log(`  分镜数: ${timeline.length}`)

if (DRY) {
  console.log('\n（--dry 模式，未合成）\n')
  process.exit(0)
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

fs.mkdirSync(OUTDIR, { recursive: true })
const TMP = path.join(os.tmpdir(), 'sk-edit-' + Date.now())
fs.mkdirSync(TMP, { recursive: true })

console.log('\n================ 合成中 ================\n')

const clipFiles = []
for (let i = 0; i < timeline.length; i++) {
  const seg = timeline[i]
  const out = path.join(TMP, `clip${String(i).padStart(2, '0')}.mp4`)
  const [ss, to] = seg.src
  const dur = to - ss

  const vfParts = []

  vfParts.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`)
  vfParts.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0d0b12`)
  vfParts.push(`fps=${FPS}`)

  const main = escText(seg.line)
  vfParts.push(`drawtext=${SUB_STYLE}:text='${main}'`)
  if (seg.sub) {
    const subStyle = SUB_STYLE.replace('fontsize=46', 'fontsize=34')
      .replace('y=h-text_h-72', 'y=h-text_h-134')
      .replace('fontcolor=white', 'fontcolor=0xffd9ea')
    vfParts.push(`drawtext=${subStyle}:text='${escText(seg.sub)}'`)
  }

  if (i === 0) vfParts.push(`fade=t=in:st=0:d=0.6`)
  if (seg.fadeOut) vfParts.push(`fade=t=out:st=${(dur - 0.8).toFixed(2)}:d=0.8`)
  if (i > 0 && !seg.fadeOut) vfParts.push(`fade=t=in:st=0:d=0.25`)

  const ok = run(
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(ss), '-t', String(dur), '-i', SRC,
      '-vf', vfParts.join(','),
      '-an',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
      '-pix_fmt', 'yuv420p',
      out
    ],
    `片段 ${i + 1}`
  )
  if (!ok) process.exit(1)
  clipFiles.push(out)
  process.stdout.write(`  ✓ 片段 ${i + 1}/${timeline.length}  ${fmtT(ss)}–${fmtT(to)}  ${seg.line.slice(0, 28)}\n`)
}

console.log('\n  拼接分镜…')
const listFile = path.join(TMP, 'list.txt')
fs.writeFileSync(listFile, clipFiles.map((f) => `file '${f.replace(/\\/g, '/')}'`).join('\n'), 'utf-8')

const merged = path.join(TMP, 'merged.mp4')
if (!run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', merged], '拼接')) {
  process.exit(1)
}

console.log('  混合 BGM…')

const BGM1_SS = 26
const BGM2_SS = 34

const bgm1Dur = bgm1End
const bgm2Dur = total - bgm1End

const filter = [
  `[0:v]setpts=PTS-STARTPTS[v]`,
  `[1:a]atrim=start=${BGM1_SS}:duration=${bgm1Dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=1.2,afade=t=out:st=${(bgm1Dur - 1.6).toFixed(3)}:d=1.6,` +
    `volume=0.5[b1]`,
  `[2:a]atrim=start=${BGM2_SS}:duration=${bgm2Dur.toFixed(3)},asetpts=PTS-STARTPTS,` +
    `afade=t=in:st=0:d=1.2,afade=t=out:st=${(bgm2Dur - 2.0).toFixed(3)}:d=2.0,` +
    `volume=0.5[b2]`,
  `[b2]adelay=${Math.round(bgm1End * 1000)}|${Math.round(bgm1End * 1000)}[b2d]`,
  `[b1][b2d]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[bgm]`,
  `[bgm]alimiter=limit=0.94,aresample=44100[aout]`
].join(';')

const OUT = path.join(OUTDIR, '守岸人陪伴终端-演示片.mp4')
if (
  !run(
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', merged,
      '-ss', String(BGM1_SS), '-i', BGM1,
      '-ss', String(BGM2_SS), '-i', BGM2,
      '-filter_complex', filter,
      '-map', '[v]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
      '-shortest',
      '-movflags', '+faststart',
      OUT
    ],
    '混音'
  )
) {
  process.exit(1)
}

const stat = fs.statSync(OUT)
console.log('\n================ 完成 ================\n')
console.log(`  成片: ${OUT}`)
console.log(`  大小: ${(stat.size / 1024 / 1024).toFixed(1)} MB`)
console.log(`  时长: ${fmtT(total)}`)
console.log(`  规格: ${W}×${H} @ ${FPS}fps`)
console.log('')

fs.rmSync(TMP, { recursive: true, force: true })
