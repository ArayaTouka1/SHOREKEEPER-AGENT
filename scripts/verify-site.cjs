/**
 *
 */
const fs = require('node:fs')
const path = require('node:path')

const WEB = path.resolve(__dirname, '..', '..', 'web')
let pass = 0
let fail = 0
const fails = []

function check(name, cond, extra) {
  if (cond) {
    pass++
    console.log('  OK   ' + name)
  } else {
    fail++
    fails.push(name + (extra ? ' -> ' + extra : ''))
    console.log('  FAIL ' + name + (extra ? '  -> ' + extra : ''))
  }
}

const htmlPath = path.join(WEB, 'index.html')
if (!fs.existsSync(htmlPath)) {
  console.error('index.html 不存在：' + htmlPath)
  process.exit(1)
}
const html = fs.readFileSync(htmlPath, 'utf8')


console.log('=== 1. 需求覆盖 ===')
const required = [
  ['软件介绍', '软件介绍'],
  ['版权声明', '版权声明'],
  ['软件下载', '软件下载'],
  ['项目地址', '项目地址'],
  ['本地 TTS 模型下载', '本地 TTS 模型下载']
]
for (const [label, needle] of required) {
  check('含「' + label + '」', html.includes(needle))
}

for (const id of ['top', 'features', 'roles', 'gallery', 'download', 'tts', 'project', 'license']) {
  check('锚点 id="' + id + '" 存在', html.includes('id="' + id + '"'))
}


console.log('\n=== 2. 资源完整性 ===')
const refs = new Set()
const attrRe = /(?:src|href)="([^"]+)"/g
let m
while ((m = attrRe.exec(html))) {
  const v = m[1]
  if (/^(https?:|mailto:|tel:|data:|#)/i.test(v)) continue
  refs.add(v)
}
let missing = 0
for (const rel of refs) {
  const p = path.join(WEB, rel.replace(/^\.\//, ''))
  if (!fs.existsSync(p)) {
    missing++
    console.log('     缺失: ' + rel)
  }
}
check('所有本地引用资源存在（' + refs.size + ' 个引用）', missing === 0, missing + ' 个缺失')


console.log('\n=== 3. 锚点链接有效性 ===')
const anchorRe = /href="#([^"]+)"/g
const ids = new Set()
const idRe = /id="([^"]+)"/g
let im
while ((im = idRe.exec(html))) ids.add(im[1])

let badAnchor = 0
const seen = new Set()
while ((m = anchorRe.exec(html))) {
  const a = m[1]
  if (seen.has(a)) continue
  seen.add(a)
  if (!ids.has(a)) {
    badAnchor++
    console.log('     断链: #' + a)
  }
}
check('所有页面内锚点有对应目标（' + seen.size + ' 个）', badAnchor === 0, badAnchor + ' 个断链')


console.log('\n=== 4. 下载产物 ===')
const version = (html.match(/v?(\d+\.\d+\.\d+)/) || [])[1] || '0.21.0'
const setup = '守岸人陪伴终端-' + version + '-x64-setup.exe'
const portable = '守岸人陪伴终端-' + version + '-x64-portable.exe'
const dlDir = path.join(WEB, 'downloads')

check('版本号解析正确（' + version + '）', /^\d+\.\d+\.\d+$/.test(version))
check('downloads/ 目录存在', fs.existsSync(dlDir))
if (fs.existsSync(dlDir)) {
  const files = fs.readdirSync(dlDir)
  check('安装包在 downloads/（' + setup + '）', files.includes(setup), files.join(',') || '(空)')
  check('便携版在 downloads/（' + portable + '）', files.includes(portable))
  const s = files.includes(setup) ? fs.statSync(path.join(dlDir, setup)).size : 0
  check('安装包体积合理（> 100MB）', s > 100 * 1024 * 1024, (s / 1024 / 1024).toFixed(1) + ' MB')
}


console.log('\n=== 5. 脚本与样式 ===')
const js = fs.readFileSync(path.join(WEB, 'assets', 'main.js'), 'utf8')
const css = fs.readFileSync(path.join(WEB, 'assets', 'style.css'), 'utf8')
check('main.js 版本与页面一致', js.includes("'" + version + "'"), 'js 里未找到 ' + version)
check('main.js 含下载探测逻辑', js.includes('upgradeDownloads'))
check('main.js 含哈希复制', js.includes('wireHashCopy'))
check('style.css 含响应式断点', css.includes('@media (max-width: 860px)'))
check('style.css 定义主题变量', css.includes('--accent-grad'))


console.log('\n=== 6. 部署前待替换项（提示，不计失败）===')
const placeholders = html.match(/&lt;your-name&gt;/g)
console.log('    项目地址占位符：' + (placeholders ? placeholders.length : 0) + ' 处（部署前替换为你的仓库地址）')


console.log('\n========================================')
console.log('  静态校验：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('========================================')
if (fail) {
  console.log('\n失败项：')
  fails.forEach((f) => console.log('  - ' + f))
}
process.exit(fail === 0 ? 0 : 1)
