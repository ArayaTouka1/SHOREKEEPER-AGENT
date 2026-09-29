const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const version = require('../package.json').version
const installer = path.join(root, 'release/installer', `守岸人陪伴终端-${version}-x64-setup.exe`)
const sevenZip = require('7zip-bin').path7za
const hash = data => crypto.createHash('sha256').update(data).digest('hex')
const archive = execFileSync(sevenZip, ['l', '-slt', '-sccUTF-8', installer], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
assert.ok(!/(?:^|[\\/])(?:\.verification|userData|uploads|chat\.json|settings\.json|relationships\.json|memory\.json|\.env)(?:[\\/\r\n]|$)/im.test(archive))
for (const name of ['app.asar', 'icon.png', 'splash\\opening.mp4']) {
  const bytes = execFileSync(sevenZip, ['e', '-so', installer, 'resources\\' + name], { maxBuffer: 128 * 1024 * 1024 })
  assert.equal(hash(bytes), hash(fs.readFileSync(path.join(root, 'release/win-unpacked/resources', name))), name + ' in installer differs from audited payload')
}
assert.equal(hash(fs.readFileSync(path.join(root, 'release/win-unpacked/resources/icon.png'))), hash(fs.readFileSync(path.join(root, '../icon.png'))))
const report = { version, verifiedAt: new Date().toISOString(), installer: path.basename(installer), bytes: fs.statSync(installer).size, sha256: hash(fs.readFileSync(installer)), payloadMatchesAudit: true, iconMatchesSource: true }
fs.writeFileSync(path.join(root, 'release/installer-verification.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
