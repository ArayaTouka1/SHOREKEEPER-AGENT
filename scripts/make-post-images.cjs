/**
 */

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const FF = 'C:\\Users\\Administrator\\.dsh-wallpaper-engine\\ffmpeg\\ffmpeg.exe'
const SRC = 'C:\\Users\\Administrator\\Desktop\\守岸人agent.mp4'
const OUT = 'F:\\work\\aiagent\\图文配图'

const SHOTS = [
  { t: 46.5, name: '00-封面-你愿意让这样的她陪伴着你吗.jpg' },
  { t: 1.5, name: '01-启动页.jpg' },
  { t: 10.0, name: '02-首页-晚上好.jpg' },
  { t: 19.0, name: '03-对话-给我找个能通宵的玩法.jpg' },
  { t: 26.0, name: '04-磁盘扫描.jpg' },
  { t: 30.0, name: '05-结果-还剩99.6G.jpg' },
  { t: 31.5, name: '06-字幕卡-也可以陪你听歌.jpg' },
  { t: 37.0, name: '07-音乐播放器.jpg' },
  { t: 42.0, name: '08-主题页.jpg' }
]

fs.mkdirSync(OUT, { recursive: true })

console.log('\n================ 截取配图 ================\n')

for (const s of SHOTS) {
  const dest = path.join(OUT, s.name)
  try {
    execFileSync(
      FF,
      [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', String(s.t), '-i', SRC,
        '-frames:v', '1',
        '-q:v', '2',
        dest
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    )
    const kb = (fs.statSync(dest).size / 1024).toFixed(0)
    console.log(`  ✓ ${s.name}   (${s.t}s, ${kb} KB)`)
  } catch (e) {
    console.error(`  ✗ ${s.name} 失败: ${String(e.stderr || '').slice(0, 200)}`)
  }
}

console.log(`\n  输出目录: ${OUT}\n`)
