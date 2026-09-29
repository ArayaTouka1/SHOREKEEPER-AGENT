/**
 *
 *
 *
 */
const { existsSync, readFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const ROOT = resolve(__dirname, '..')
const read = (p) => readFileSync(join(ROOT, p), 'utf-8')

let pass = 0
let fail = 0
const fails = []
function check(name, fn) {
  try {
    const r = fn()
    if (r === false) throw new Error('断言返回 false')
    pass++
    console.log('  PASS  ' + name)
  } catch (err) {
    fail++
    fails.push(name + ' -> ' + (err && err.message ? err.message : String(err)))
    console.log('  FAIL  ' + name + '  -> ' + (err && err.message ? err.message : String(err)))
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

;(async () => {
  console.log('\n=== 1. UI：本地合成入口已删除 ===')
  check('引擎选择器不再提供 local 选项', () => {
    const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
    assert(!src.includes("k: 'local'"), '引擎卡仍有 local 选项')
    return true
  })
  check('引擎选项只剩：云合成 / 系统合成 / 不发声', () => {
    const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
    assert(src.includes("k: 'inworld'"), '缺云合成')
    assert(src.includes("k: 'system'"), '缺系统合成')
    assert(src.includes("k: 'none'"), '缺不发声')
    return true
  })
  check('本地面板文件已删除', () => {
    for (const f of ['KokoroPanel.tsx', 'LocalTtsPanel.tsx', 'QwenOneClickDeploy.tsx', 'QwenPreparationPanel.tsx']) {
      assert(!existsSync(join(ROOT, 'src/renderer/src/pages/settings', f)), f + ' 仍存在')
    }
    return true
  })
  check('VoiceSection 不再引用任何本地面板', () => {
    const src = read('src/renderer/src/pages/settings/VoiceSection.tsx')
    assert(!/KokoroPanel|LocalTtsPanel|QwenOneClickDeploy/.test(src), '仍有本地面板引用')
    return true
  })
  check('PersonaSwitcher 不再显示「本地合成」', () => {
    const src = read('src/renderer/src/components/PersonaSwitcher.tsx')
    assert(!/本地合成/.test(src), '仍有本地合成文案')
    return true
  })

  console.log('\n=== 2. useSpeech：本地合成分支已删除 ===')
  check('无 speakLocal / kokoro / qwen3 分支', () => {
    const src = read('src/renderer/src/hooks/useSpeech.ts')
    assert(!src.includes('speakLocal'), '仍有 speakLocal')
    assert(!src.includes('kokoro'), '仍有 kokoro')
    assert(!src.includes('qwen3'), '仍有 qwen3')
    return true
  })
  check('语音路线：pack / inworld / synth / off', () => {
    const src = read('src/renderer/src/hooks/useSpeech.ts')
    assert(/mode: 'pack' \| 'inworld' \| 'synth' \| 'off'/.test(src), 'SpeechApi mode 类型不对')
    assert(src.includes('playPack'), '缺语音包播放')
    assert(src.includes('speakInworld'), '缺 inworld')
    assert(src.includes('speakSynth'), '缺系统合成')
    return true
  })

  console.log('\n=== 3. 底层模块与打包项已清理 ===')
  check('本地引擎模块全部删除', () => {
    for (const f of ['kokoroTts.ts', 'kokoro-worker.cjs', 'qwen3Tts.ts', 'qwenLunar.ts', 'qwenPreparation.ts', 'localTts.ts', 'localTtsService.ts', 'ttsEngine.ts']) {
      assert(!existsSync(join(ROOT, 'src/main', f)), f + ' 仍存在')
    }
    return true
  })
  check('electron-builder 不再分发 sherpa-onnx / kokoro', () => {
    const yml = read('electron-builder.yml')
    assert(!/resources\/sherpa-onnx/.test(yml), '仍在分发 sherpa-onnx')
    assert(!/resources\/kokoro/.test(yml), '仍在分发 kokoro')
    return true
  })
  check('主进程不再注册本地引擎 IPC', () => {
    const idx = read('src/main/index.ts')
    assert(!/kokoroStatus|synthesizeKokoro|qwen3Synthesize|ttsServiceStatus/.test(idx), '仍有本地引擎 handler')
    return true
  })

  console.log('\n=== 4. 类型与迁移 ===')
  check("VoiceEngine 不再含 'local'", () => {
    const t = read('src/shared/types.ts')
    assert(/export type VoiceEngine = 'voice-pack' \| 'inworld' \| 'system' \| 'none'/.test(t), 'VoiceEngine 定义不对')
    return true
  })
  check('local / gpt-sovits / cosyvoice 迁回 voice-pack', () => {
    const src = read('src/main/character.ts')
    assert(/legacy === 'gpt-sovits' \|\| legacy === 'cosyvoice' \|\| legacy === 'local'/.test(src), '迁移分支不对')
    assert(/v\.engine = 'voice-pack'/.test(src), '没有迁回 voice-pack')
    return true
  })
  check('VALID_ENGINES 不再含 local', () => {
    const src = read('src/main/character.ts')
    assert(!/VALID_ENGINES.*'local'/.test(src), 'VALID_ENGINES 仍有 local')
    return true
  })
  check('默认角色引擎是 voice-pack', () => {
    const src = read('src/main/character.ts')
    assert(/engine: 'voice-pack'/.test(src), '默认引擎不是 voice-pack')
    return true
  })

  console.log('\n=== 5. 气泡零等待（不让用户等语音） ===')
  check('done 后 syncRatio 初值是 1（立即显示全文）', () => {
    const src = read('src/renderer/src/store/AppStore.tsx')
    assert(/syncRatio: 1 \}\)/.test(src) || /syncRatio: 1/.test(src), 'done 分支没有把 syncRatio 置 1')
    return true
  })
  check('播放器不在一开始就把进度归零', () => {
    const src = read('src/renderer/src/hooks/useSpeech.ts')
    assert(!/setSpeaking\(true\)\s*\n\s*progressRef\.current\?\.\(0\)/.test(src), 'playUrl 仍在开始时归零')
    return true
  })
  check('合成/播放失败都会立即显示全文（上报 1）', () => {
    const src = read('src/renderer/src/hooks/useSpeech.ts')
    const n = (src.match(/progressRef\.current\?\.\(1\)/g) || []).length
    assert(n >= 4, '失败兜底上报过少：' + n)
    return true
  })

  console.log('\n=== 6. Agent 联网（web_search 多源回退） ===')
  check('web_search 有多个搜索源（Bing 主源 + 回退）', () => {
    const src = read('src/main/agentTools.ts')
    assert(/bing\.com\/search/.test(src), '缺 Bing 源')
    assert(/html\.duckduckgo\.com/.test(src), '缺 DuckDuckGo 回退源')
    assert(/parseBing/.test(src), '缺 Bing 解析')
    return true
  })
  check('联网请求带超时保护', () => {
    const src = read('src/main/agentTools.ts')
    assert(/fetchWithTimeout/.test(src), '缺超时封装')
    assert(/AbortController/.test(src), '缺 AbortController')
    return true
  })

  console.log('\n========================================')
  console.log('  本地语音删除 + 气泡零等待 + 联网：通过 ' + pass + ' 项，失败 ' + fail + ' 项')
  console.log('========================================')
  if (fail) {
    console.log('\n失败项：')
    fails.forEach((f) => console.log('  - ' + f))
  }
  process.exit(fail === 0 ? 0 : 1)
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
