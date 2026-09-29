import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/AppStore'
import { EmptyHint, Field } from '../../components/ui'
import type { CloudTtsConfig, InworldVoice, TtsProvider } from '../../../../shared/types'

/**
 *
 */
export default function CloudTtsPanel(): React.ReactElement {
  const {
    settings,
    saveSettings,
    character,
    saveCharacter,
    inworldVoices,
    refreshInworldVoices,
    testInworld,
    reloadBootstrap
  } = useApp()

  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState<null | { ok: boolean; message: string }>(null)
  const [newModel, setNewModel] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [manualVoice, setManualVoice] = useState('')

  const cfg: CloudTtsConfig | undefined = settings?.cloudTts
  const cv = character?.voice

  const [draft, setDraft] = useState<CloudTtsConfig | null>(null)
  /**
   */
  const selfSaveRef = React.useRef(false)
  useEffect(() => {
    if (!cfg) return
    if (selfSaveRef.current) {
      selfSaveRef.current = false
      return
    }
    setDraft({ ...cfg })
  }, [cfg?.provider, cfg?.apiKey, cfg?.baseUrl, cfg?.model, cfg?.authMode, cfg?.customModels, cfg?.voicesPath, cfg?.speechPath])

  const models = useMemo(() => {
    if (!draft) return []
    const base =
      draft.provider === 'inworld'
        ? ['inworld-tts-2', 'inworld-tts-1-max', 'inworld-tts-1']
        : draft.provider === 'openai-compatible'
          ? ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']
          : []
    return Array.from(new Set([...base, ...draft.customModels, draft.model].filter(Boolean)))
  }, [draft?.provider, draft?.customModels, draft?.model])

  const clonedVoices = useMemo(() => inworldVoices.filter((x) => x.owned), [inworldVoices])
  const systemVoices = useMemo(() => inworldVoices.filter((x) => !x.owned), [inworldVoices])

  if (!settings || !character || !draft) return <></>

  const patch = (p: Partial<CloudTtsConfig>): void => setDraft((d) => (d ? { ...d, ...p } : d))

  /**
   *
   */
  const persist = async (p?: Partial<CloudTtsConfig>): Promise<void> => {
    const next = { ...draft, ...(p ?? {}) }
    selfSaveRef.current = true
    setDraft(next)
    await saveSettings({ cloudTts: next })
  }

  /**
   */
  const switchProvider = async (provider: TtsProvider): Promise<void> => {
    if (provider === draft.provider) return
    setTesting(null)
    setBusy(true)
    try {
      const res = await window.aimis.inworld.switchProvider(provider)
      if (!res.ok || !res.data) {
        setTesting({ ok: false, message: '切换失败：' + (res.error ?? '未知错误') })
        return
      }
      selfSaveRef.current = true
      setDraft(res.data)
      await reloadBootstrap()
      if (provider !== 'inworld') await refreshInworldVoices()
    } finally {
      setBusy(false)
    }
  }

  const providerHint =
    draft.provider === 'inworld'
      ? '填 Inworld 的 Basic 认证串（key:secret 的 base64）'
      : draft.provider === 'openai-compatible'
        ? '填 Bearer Token。适用于 OpenAI / 硅基流动 / 自建 One-API 等'
        : '完全自填接口地址、鉴权方式与模型'

  const doTest = async (): Promise<void> => {
    setBusy(true)
    setTesting(null)
    try {
      await persist()
      const r = await testInworld(undefined)
      setTesting(r)
    } finally {
      setBusy(false)
    }
  }

  const refreshVoices = async (): Promise<void> => {
    setBusy(true)
    try {
      await persist()
      await refreshInworldVoices()
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async (): Promise<void> => {
    setBusy(true)
    setTesting(null)
    try {
      await persist({ apiKey: '', verified: false })
      setTesting({ ok: true, message: '已断开连接，密钥已清空' })
      await refreshInworldVoices()
    } finally {
      setBusy(false)
    }
  }

  const addCustomModel = async (): Promise<void> => {
    const m = newModel.trim()
    if (!m) return
    if (!draft.customModels.includes(m)) {
      await persist({ customModels: [...draft.customModels, m], model: m })
    } else {
      await persist({ model: m })
    }
    setNewModel('')
  }

  const voiceCard = (x: InworldVoice): React.ReactElement => (
    <button
      key={x.voiceId}
      data-inworld-voice={x.voiceId}
      className={`pick-card ${cv?.voiceId === x.voiceId ? 'on' : ''}`}
      style={{ minWidth: 160 }}
      onClick={() => cv && void saveCharacter({ voice: { ...cv, voiceId: x.voiceId } as typeof cv })}
    >
      <div style={{ fontSize: 13 }}>{x.displayName}</div>
      <div className="pick-desc">{(x.description || x.langCode || x.source || '').slice(0, 28)}</div>
    </button>
  )

  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>
          云合成
        </div>
        <span
          style={{
            fontSize: 11,
            padding: '3px 10px',
            borderRadius: 999,
            border: '1px solid var(--stroke)',
            color: draft.verified ? 'var(--ok)' : 'var(--warn)'
          }}
        >
          {draft.verified ? '已连通' : '未验证'}
        </span>
      </div>

      {/* 服务商 */}
      <Field label="服务商协议" hint={providerHint}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(
            [
              { k: 'inworld', label: 'Inworld' },
              { k: 'openai-compatible', label: 'OpenAI 兼容' },
              { k: 'custom', label: '自定义' }
            ] as const
          ).map((p) => (
            <button
              key={p.k}
              data-tts-provider={p.k}
              className="btn sm"
              style={
                draft.provider === p.k
                  ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' }
                  : undefined
              }
              onClick={() => void switchProvider(p.k)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      {/* API Key */}
      <Field label="API Key">
        <input
          className="input"
          data-testid="inworld-key"
          type="password"
          value={draft.apiKey}
          onChange={(e) => patch({ apiKey: e.target.value })}
          onBlur={() => void persist()}
          placeholder={draft.provider === 'inworld' ? 'Basic 认证串' : 'Bearer Token'}
        />
        <button
          className="btn primary sm"
          data-testid="tts-save"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={() => void persist()}
        >
          保存配置
        </button>
      </Field>

      {/* 接口地址 —— 可自定义 */}
      <Field label="接口地址（Base URL）" hint="可改成任何兼容端点，比如自建代理或内网服务。">
        <input
          className="input"
          data-testid="tts-baseurl"
          value={draft.baseUrl}
          onChange={(e) => patch({ baseUrl: e.target.value })}
          onBlur={() => void persist()}
          placeholder="https://api.example.com/v1"
        />
      </Field>

      {/* 模型 —— 可自定义 */}
      <Field label="模型" hint={draft.customModels.length > 0 ? `已添加的自定义模型：${draft.customModels.join('、')}` : undefined}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {models.map((m) => (
            <button
              key={m}
              data-inworld-model={m}
              className="btn sm"
              style={
                draft.model === m
                  ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' }
                  : undefined
              }
              onClick={() => void persist({ model: m })}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input grow"
            data-testid="tts-model-input"
            value={newModel}
            placeholder="输入自定义模型名，如 my-tts-v2"
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addCustomModel()
            }}
          />
          <button className="btn sm" onClick={() => void addCustomModel()}>
            添加模型
          </button>
        </div>
      </Field>

      {/* 高级：鉴权方式与路径 */}
      <div className="field">
        <button className="btn ghost sm" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? '收起高级选项' : '高级选项'}
        </button>
      </div>

      {showAdvanced && (
        <>
          <Field label="鉴权方式">
            <div className="row" style={{ gap: 8 }}>
              {(
                [
                  { k: 'bearer', label: 'Bearer Token' },
                  { k: 'basic', label: 'Basic' },
                  { k: 'none', label: '不需要' }
                ] as const
              ).map((a) => (
                <button
                  key={a.k}
                  data-tts-auth={a.k}
                  className="btn sm"
                  style={
                    draft.authMode === a.k
                      ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' }
                      : undefined
                  }
                  onClick={() => void persist({ authMode: a.k })}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="合成路径">
            <input
              className="input"
              value={draft.speechPath}
              onChange={(e) => patch({ speechPath: e.target.value })}
              onBlur={() => void persist()}
              placeholder="留空默认 audio/speech"
            />
          </Field>

          <Field label="音色列表路径">
            <input
              className="input"
              value={draft.voicesPath}
              onChange={(e) => patch({ voicesPath: e.target.value })}
              onBlur={() => void persist()}
              placeholder="留空自动探测 audio/voices → voices → models"
            />
          </Field>
        </>
      )}

      <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button className="btn primary" data-testid="tts-test" disabled={busy} onClick={() => void doTest()}>
          测试连通
        </button>
        <button className="btn" disabled={busy} onClick={() => void refreshVoices()}>
          刷新音色列表
        </button>
        {/* 已连通时提供断开入口 */}
        {(draft.verified || draft.apiKey) && (
          <button
            className="btn danger"
            data-testid="tts-disconnect"
            disabled={busy}
            onClick={() => void disconnect()}
            title="清空密钥并断开连接"
          >
            断开连接
          </button>
        )}
        {testing && (
          <span style={{ fontSize: 12, color: testing.ok ? 'var(--ok)' : 'var(--err)' }}>{testing.message}</span>
        )}
      </div>

      {/* 音色 —— 克隆音色 + 可折叠的完整音色库 */}
      {clonedVoices.length > 0 && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 6 }}>
            克隆音色（{clonedVoices.length}）—— 推荐绑定给角色
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>{clonedVoices.map(voiceCard)}</div>
        </>
      )}

      <VoiceLibrary
        voices={systemVoices}
        currentVoiceId={cv?.voiceId ?? ''}
        onPick={(id) => cv && void saveCharacter({ voice: { ...cv, voiceId: id } })}
      />

      {/* 手填音色（自定义服务用） */}
      <Field style={{ marginTop: 14 }} label="手动指定音色 ID">
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input grow"
            data-testid="tts-voice-input"
            value={manualVoice}
            placeholder="例如 alloy / zh-CN-Xiaoxiao / 自定义音色名"
            onChange={(e) => setManualVoice(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manualVoice.trim() && cv) {
                void saveCharacter({ voice: { ...cv, voiceId: manualVoice.trim() } })
              }
            }}
          />
          <button
            className="btn sm"
            disabled={!manualVoice.trim() || !cv}
            onClick={() => cv && void saveCharacter({ voice: { ...cv, voiceId: manualVoice.trim() } })}
          >
            使用
          </button>
        </div>
      </Field>

      {cv?.voiceId && (
        <div style={{ fontSize: 11, color: 'var(--text-4)', marginTop: 12 }}>
          当前绑定音色：{cv.voiceId}
          {inworldVoices.find((v) => v.voiceId === cv.voiceId)
            ? `（${inworldVoices.find((v) => v.voiceId === cv.voiceId)!.displayName}）`
            : ''}
        </div>
      )}
    </div>
  )
}

/* ==================================================================
   音色库 —— 可展开/隐藏，带搜索与语言筛选
   ================================================================== */

function VoiceLibrary({
  voices,
  currentVoiceId,
  onPick
}: {
  voices: InworldVoice[]
  currentVoiceId: string
  onPick: (voiceId: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('全部')
  const [showAll, setShowAll] = useState(false)

  const langs = useMemo(() => {
    const set = new Set<string>()
    for (const v of voices) {
      const l = (v.langCode || '').split(/[-_]/)[0].toUpperCase()
      if (l) set.add(l)
    }
    return ['全部', ...Array.from(set).sort()]
  }, [voices])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return voices.filter((v) => {
      if (lang !== '全部') {
        const l = (v.langCode || '').split(/[-_]/)[0].toUpperCase()
        if (l !== lang) return false
      }
      if (!q) return true
      return (
        v.voiceId.toLowerCase().includes(q) ||
        v.displayName.toLowerCase().includes(q) ||
        (v.description || '').toLowerCase().includes(q)
      )
    })
  }, [voices, query, lang])

  const shown = showAll ? filtered : filtered.slice(0, 60)

  return (
    <div className="card card-pad" style={{ background: 'var(--glass)', marginBottom: 14 }}>
      {/* 折叠头 */}
      <button
        data-testid="voice-lib-toggle"
        data-open={open ? '1' : '0'}
        className="row"
        style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 13 }}>可用音色库</span>
          <span
            style={{
              fontSize: 10.5,
              padding: '1px 8px',
              borderRadius: 999,
              border: '1px solid var(--stroke)',
              color: 'var(--text-3)'
            }}
          >
            {voices.length}
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>{open ? '收起 ▲' : '展开 ▼'}</span>
      </button>

      {open && (
        <div style={{ marginTop: 14 }} data-testid="voice-lib-body">
          {voices.length === 0 ? (
            <EmptyHint>没拉到音色列表。自定义服务可以在下面手填音色 ID。</EmptyHint>
          ) : (
            <>
              {/* 搜索 + 语言筛选 */}
              <div className="row" style={{ gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                <input
                  className="input grow"
                  data-testid="voice-lib-search"
                  style={{ minWidth: 160 }}
                  value={query}
                  placeholder="搜索音色名或 ID…"
                  onChange={(e) => setQuery(e.target.value)}
                />
                <select
                  className="input"
                  data-testid="voice-lib-lang"
                  style={{ maxWidth: 130 }}
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                >
                  {langs.map((l) => (
                    <option key={l} value={l}>
                      {l === '全部' ? '全部语言' : l}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ fontSize: 11, color: 'var(--text-4)', marginBottom: 8 }}>
                匹配 {filtered.length} 个{!showAll && filtered.length > 60 ? `（先显示前 60 个）` : ''}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))',
                  gap: 8,
                  maxHeight: open ? 340 : undefined,
                  overflowY: 'auto',
                  paddingRight: 4
                }}
              >
                {shown.map((x) => (
                  <button
                    key={x.voiceId}
                    data-inworld-voice={x.voiceId}
                    className={`pick-card ${currentVoiceId === x.voiceId ? 'on' : ''}`}
                    onClick={() => onPick(x.voiceId)}
                    title={x.voiceId}
                  >
                    <div className="truncate" style={{ fontSize: 12.5 }}>
                      {x.displayName}
                    </div>
                    <div className="pick-desc truncate">{x.langCode || x.source || '—'}</div>
                  </button>
                ))}
                {shown.length === 0 && (
                  <EmptyHint style={{ gridColumn: '1 / -1' }}>没有匹配的音色</EmptyHint>
                )}
              </div>

              {!showAll && filtered.length > 60 && (
                <button className="btn sm" style={{ marginTop: 10 }} onClick={() => setShowAll(true)}>
                  显示全部 {filtered.length} 个
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
