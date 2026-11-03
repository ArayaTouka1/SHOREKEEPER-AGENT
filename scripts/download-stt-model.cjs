const { createHash } = require('node:crypto')
const { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } = require('node:fs')
const { pipeline } = require('node:stream/promises')
const { Readable } = require('node:stream')
const path = require('node:path')

const REPO = 'onnx-community/whisper-tiny'
const REVISION = 'ff4177021cc41f7db950912b73ea4fdf7d01d8e7'
const FILES = [
  'README.md', 'added_tokens.json', 'config.json', 'generation_config.json',
  'merges.txt', 'normalizer.json', 'preprocessor_config.json',
  'quantize_config.json', 'special_tokens_map.json', 'tokenizer.json',
  'tokenizer_config.json', 'vocab.json',
  'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'
]
const TARGET = path.resolve(__dirname, '../resources/stt-model', REPO)

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

async function main() {
  const treeUrl = `https://huggingface.co/api/models/${REPO}/tree/${REVISION}?recursive=true&expand=true`
  const treeResponse = await fetch(treeUrl, { signal: AbortSignal.timeout(30000) })
  if (!treeResponse.ok) throw new Error(`读取模型清单失败：HTTP ${treeResponse.status}`)
  const tree = await treeResponse.json()
  const meta = new Map(tree.map((entry) => [entry.path, entry]))
  for (const name of FILES) {
    const expected = meta.get(name)
    if (!expected || !Number.isSafeInteger(expected.size)) throw new Error(`模型仓库缺少文件：${name}`)
    const destination = path.join(TARGET, ...name.split('/'))
    mkdirSync(path.dirname(destination), { recursive: true })
    if (existsSync(destination) && statSync(destination).size === expected.size && (!expected.lfs?.oid || sha256(destination) === expected.lfs.oid)) {
      console.log(`已有：${name}`)
      continue
    }
    const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) })
    if (!response.ok || !response.body) throw new Error(`下载 ${name} 失败：HTTP ${response.status}`)
    const temporary = `${destination}.part`
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
      const size = statSync(temporary).size
      if (size !== expected.size) throw new Error(`${name} 大小错误：${size}/${expected.size}`)
      if (expected.lfs?.oid && sha256(temporary) !== expected.lfs.oid) throw new Error(`${name} SHA-256 校验失败`)
      renameSync(temporary, destination)
      console.log(`已下载：${name} (${(size / 1024 / 1024).toFixed(1)} MiB)`)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
  console.log(`模型已准备：${TARGET}`)
}

main().catch((error) => { console.error(error.message); process.exitCode = 1 })
