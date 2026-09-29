const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const asar = require('@electron/asar')
const { verifyReferenceVoices } = require('./verify-reference-voices.cjs')

const resourceRoots = new Set(['icon.png', 'app.asar', 'app.asar.unpacked', 'elevate.exe', 'app-update.yml', 'cards', 'persona-profiles', 'personas', 'plugins', 'qwen3tts', 'qwen3voices', 'stickers', 'voices', 'opus', 'splash', 'sherpa-onnx', 'kokoro'])
const privateName = /(^|\/)(\.env[^/]*|\.verification|userData|uploads|conversations|chat\.json|memory\.json|relationships\.json|settings\.json|models\.json|workspace-security\.json|Cookies|Login Data|Local Storage|Session Storage)(\/|$)|\.(log|sqlite|db|pem|pfx)$/i
const textType = /\.(js|cjs|mjs|json|html|css|md|txt|ya?ml|ini)$/i
const privatePath = /(?:F:[\\/]+work[\\/]+aiagent|C:[\\/]+Users[\\/]+Administrator)/i
const credential = /\bsk-[A-Za-z0-9_-]{20,}\b|\bAIza[A-Za-z0-9_-]{30,}\b|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/

function inspect(name, data) {
  if (privateName.test(name)) throw new Error('Private profile file in package: ' + name)
  if (!textType.test(name)) return
  const text = data.toString('utf8')
  if (privatePath.test(text)) throw new Error('Developer machine path in package: ' + name)
  if (credential.test(text)) throw new Error('Possible embedded credential in package: ' + name)
}

module.exports = async function auditPackage(context) {
  const root = path.join(context.appOutDir, 'resources')
  const archive = path.join(root, 'app.asar')
  const opening = fs.readFileSync(path.join(root, 'splash/opening.mp4'))
  const sourceOpening = fs.readFileSync(path.resolve(__dirname, '../resources/splash/opening.mp4'))
  if (!opening.length || !opening.equals(sourceOpening)) throw new Error('Default opening video missing or differs from source')
  const referenceVoices = verifyReferenceVoices(path.join(root, 'qwen3voices'), true)
  const sourceVoices = verifyReferenceVoices(path.resolve(__dirname, '../resources/qwen3voices'))
  if (JSON.stringify(referenceVoices) !== JSON.stringify(sourceVoices)) throw new Error('Packaged reference voices differ from public source assets')
  const manifest = []
  const add = (name, data) => {
    if (data && typeof data === 'object' && 'size' in data && !Buffer.isBuffer(data)) {
      manifest.push({ path: name, bytes: data.size, sha256: 'skipped-large-binary' })
      return
    }
    manifest.push({ path: name, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') })
  }
  for (const raw of asar.listPackage(archive)) {
    const name = raw.replace(/\\/g, '/').replace(/^\//, '')
    const stat = asar.statFile(archive, path.normalize(name))
    if (stat.files) continue
    if (!/^(out\/(main|preload|renderer)\/|node_modules\/|package\.json$)/.test(name)) throw new Error('Unexpected application file: ' + name)
    if (privateName.test(name)) throw new Error('Private file in archive: ' + name)
    if (!name.startsWith('node_modules/')) {
      const data = asar.extractFile(archive, path.normalize(name))
      inspect(name, data)
      add('app.asar/' + name, data)
    }
  }
  const walk = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      const relative = path.relative(root, full).replace(/\\/g, '/')
      if (!resourceRoots.has(relative.split('/')[0])) throw new Error('Unexpected resource: ' + relative)
      if (item.isSymbolicLink()) throw new Error('Resource symlink is not allowed: ' + relative)
      if (item.isDirectory()) { walk(full); continue }
      if (/persona-profiles\/.*_(MEMORY|STATE)\.md$/i.test(relative)) throw new Error('Dynamic character state in package: ' + relative)
      const stat = fs.statSync(full)
      if (stat.size > 50 * 1024 * 1024) {
        add(relative, { size: stat.size })
        continue
      }
      const data = fs.readFileSync(full)
      inspect(relative, data)
      add(relative, data)
    }
  }
  walk(root)
  const packaged = JSON.parse(asar.extractFile(archive, 'package.json').toString())
  const report = { version: packaged.version, auditedAt: new Date().toISOString(), result: 'PASS', files: manifest }
  fs.writeFileSync(path.join(path.dirname(context.appOutDir), 'package-privacy-audit.json'), JSON.stringify(report, null, 2))
  console.log('  Package privacy audit PASS: ' + manifest.length + ' entries; no profile files, developer paths or matched credentials.')
}

if (require.main === module) module.exports({ appOutDir: path.resolve(__dirname, '../release/win-unpacked') }).catch(error => { console.error(error.message); process.exitCode = 1 })
