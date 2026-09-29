const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')

const expected = ['shorekeeper', 'aemeath', 'firefly', 'chloe']

function verifyReferenceVoices(root, strict = false) {
  const index = JSON.parse(fs.readFileSync(path.join(root, 'voices.json'), 'utf8'))
  assert.deepEqual(index.voices.map(voice => voice.id).sort(), [...expected].sort(), 'Unexpected public reference voice list')
  const allowed = new Set(['voices.json', ...expected.map(id => `${id}.wav`)])
  if (strict) {
    for (const name of fs.readdirSync(root)) assert(allowed.has(name), `Unapproved public voice asset: ${name}`)
  }
  return index.voices.map(voice => {
    assert.equal(voice.file, `${voice.id}.wav`)
    const data = fs.readFileSync(path.join(root, voice.file))
    assert(data.length > 1024 && data.length < 5 * 1024 * 1024, `Invalid reference size: ${voice.file}`)
    assert.equal(data.subarray(0, 4).toString(), 'RIFF')
    assert.equal(data.subarray(8, 12).toString(), 'WAVE')
    let pcm = false
    let samples = 0
    for (let offset = 12; offset + 8 <= data.length;) {
      const tag = data.subarray(offset, offset + 4).toString()
      const size = data.readUInt32LE(offset + 4)
      assert(offset + 8 + size <= data.length, 'Truncated WAV chunk')
      if (tag === 'fmt ') {
        assert(size >= 16)
        assert.equal(data.readUInt16LE(offset + 8), 1)
        assert.equal(data.readUInt16LE(offset + 10), 1)
        assert.equal(data.readUInt32LE(offset + 12), 24000)
        assert.equal(data.readUInt16LE(offset + 22), 16)
        pcm = true
      }
      if (tag === 'data') samples += size / 2
      offset += 8 + size + (size % 2)
    }
    assert(pcm && samples > 24000, 'Missing reference audio samples')
    return { file: voice.file, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }
  })
}

module.exports = { verifyReferenceVoices }
if (require.main === module) {
  const root = process.argv[2] || path.resolve(__dirname, '../resources/qwen3voices')
  console.log(JSON.stringify({ result: 'PASS', voices: verifyReferenceVoices(root, Boolean(process.argv[2])) }, null, 2))
}
