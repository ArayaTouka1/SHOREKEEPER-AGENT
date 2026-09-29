import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../../store/AppStore'
import { EmptyHint, Field, SectionHeader } from '../../components/ui'
import type { ModelInfo } from '../../../../shared/types'

/* ==================================================================
   模型 —— 「API 联网」按厂商分组折叠 + 「本地部署」独立一组
   本地模型必须连接成功才会出现在对话页的模型选择器里
   ================================================================== */

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  openai: 'OpenAI',
  moonshot: '月之暗面 Kimi',
  dashscope: '通义千问',
  zhipu: '智谱 GLM',
  siliconflow: '硅基流动',
  minimax: 'MiniMax',
  baichuan: '百川',
  stepfun: '阶跃星辰',
  volcengine: '豆包',
  tencent: '腾讯混元',
  openrouter: 'OpenRouter',
  groq: 'Groq'
}

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider
}

const DEFAULT_EXPANDED_PROVIDER = 'deepseek'

interface ProviderGroup {
  provider: string
  items: ModelInfo[]
}

function ModelConfig({ model, onSaved }: { model: ModelInfo; onSaved: () => Promise<void> }): React.ReactElement {
  const [baseUrl, setBaseUrl] = useState(model.baseUrl)
  const [modelId, setModelId] = useState(model.model)
  const [key, setKey] = useState(model.apiKey ?? '')
  const [status, setStatus] = useState('')
  return <details style={{ marginTop: 10 }}><summary>连接配置</summary>
    <form onSubmit={e => { e.preventDefault(); void window.aimis.model.update({ id: model.id, patch: { baseUrl, model: modelId, apiKey: key } }).then(async r => { setStatus(r.ok ? '已保存' : r.error || '保存失败'); if (r.ok) await onSaved() }).catch(e => setStatus(String(e))) }}>
      <Field label="Base URL"><input className="input" aria-label="模型服务地址" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></Field>
      <Field label="模型标识"><input className="input" aria-label="实际模型 ID" value={modelId} onChange={e => setModelId(e.target.value)} /></Field>
      <Field label="API Key"><input className="input" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} /></Field>
      <button className="btn sm" type="submit">保存连接配置</button>
      <span role="status">{status}</span>
    </form>
  </details>
}

export default function ModelSection(): React.ReactElement {
  const { models, activeModelId, selectModel, probeModel, addModel, removeModel, disconnectModel, disconnectAllModels, refreshModels, settings } =
    useApp()

  const [probing, setProbing] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; message: string }>>({})
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: '', kind: 'api' as 'api' | 'local', baseUrl: '', model: '', apiKey: '' })
  const [apiKey, setApiKey] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    [DEFAULT_EXPANDED_PROVIDER]: true
  })
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'icon' | 'list'>('icon')
  const [localOpen, setLocalOpen] = useState(false)

  useEffect(() => {
    void refreshModels()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (settings) setApiKey(settings.llm.apiKey)
  }, [settings?.llm.apiKey])

  const apiModels = models.filter((m) => m.kind === 'api')
  const localModels = models.filter((m) => m.kind === 'local')
  const connectedLocal = localModels.filter((m) => m.available)

  const keyword = query.trim().toLowerCase()

  const apiGroups = useMemo<ProviderGroup[]>(() => {
    const groups: ProviderGroup[] = []
    for (const m of models) {
      if (m.kind !== 'api') continue
      let group = groups.find((g) => g.provider === m.provider)
      if (!group) {
        group = { provider: m.provider, items: [] }
        groups.push(group)
      }
      group.items.push(m)
    }
    return groups
  }, [models])

  const matchKeyword = (m: ModelInfo): boolean =>
    !keyword ||
    m.name.toLowerCase().includes(keyword) ||
    m.model.toLowerCase().includes(keyword) ||
    m.id.toLowerCase().includes(keyword)

  const visibleGroups = apiGroups
    .map((g) => ({ provider: g.provider, items: keyword ? g.items.filter(matchKeyword) : g.items }))
    .filter((g) => g.items.length > 0)

  const matchedCount = visibleGroups.reduce((n, g) => n + g.items.length, 0)
  const allExpanded = apiGroups.length > 0 && apiGroups.every((g) => expandedGroups[g.provider])

  const toggleGroup = (provider: string): void =>
    setExpandedGroups((prev) => ({ ...prev, [provider]: !prev[provider] }))

  const toggleAll = (): void => {
    const next: Record<string, boolean> = {}
    for (const g of apiGroups) next[g.provider] = !allExpanded
    setExpandedGroups(next)
  }

  const isGroupOpen = (provider: string): boolean => (keyword ? true : !!expandedGroups[provider])

  const doProbe = async (m: ModelInfo): Promise<void> => {
    setProbing(m.id)
    try {
      const r = await probeModel(m.id, m.baseUrl)
      setResults((prev) => ({ ...prev, [m.id]: r }))
    } finally {
      setProbing(null)
    }
  }

  const doDisconnect = async (m: ModelInfo): Promise<void> => {
    setProbing(m.id)
    try {
      await disconnectModel(m.id)
      setResults((prev) => ({ ...prev, [m.id]: { ok: true, message: '已断开连接' } }))
    } finally {
      setProbing(null)
    }
  }

  const doAdd = async (): Promise<void> => {
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) return
    await addModel(draft)
    setDraft({ name: '', kind: 'api', baseUrl: '', model: '', apiKey: '' })
    setAdding(false)
  }

  const renderCard = (m: ModelInfo): React.ReactElement => {
    const isActive = m.id === activeModelId
    const res = results[m.id]
    const isLocal = m.kind === 'local'
    const usable = isLocal ? m.available : true

    if (viewMode === 'icon') {
      return (
        <button
          key={m.id}
          data-model-card={m.id}
          className="model-icon-card"
          onClick={() => usable && !isActive && void selectModel(m.id)}
          title={`${m.name} · ${m.model}${!usable ? '（需先连接）' : ''}`}
          style={{
            opacity: usable ? 1 : 0.45,
            cursor: usable ? 'pointer' : 'not-allowed'
          }}
        >
          <span className="model-icon-glyph">{isLocal ? '⬢' : '◈'}</span>
          <span className="model-icon-name truncate">{m.name}</span>
          {isActive && <span className="model-icon-check">✓</span>}
        </button>
      )
    }

    return (
      <div
        key={m.id}
        data-model-card={m.id}
        className="card"
        style={{
          padding: '13px 15px',
          background: isActive ? 'var(--accent-soft)' : 'var(--glass)',
          border: '1px solid ' + (isActive ? 'var(--accent)' : 'var(--stroke)')
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 5 }}>
          <div className="row" style={{ gap: 7, minWidth: 0 }}>
            <span style={{ fontSize: 13.5, fontWeight: 500 }}>{m.name}</span>
            <span
              style={{
                fontSize: 10,
                padding: '1px 7px',
                borderRadius: 999,
                border: '1px solid var(--stroke)',
                color: isLocal ? 'var(--ok)' : 'var(--info)'
              }}
            >
              {isLocal ? '本地部署' : 'API 联网'}
            </span>
            {isLocal && (
              <span style={{ fontSize: 10, color: m.available ? 'var(--ok)' : 'var(--text-4)' }}>
                {m.available ? '● 已连接' : '○ 未连接'}
              </span>
            )}
          </div>
          {isActive && <span style={{ fontSize: 11, color: 'var(--accent)', flexShrink: 0 }}>使用中 ✓</span>}
        </div>

        <div className="mono" style={{ color: 'var(--text-4)', marginBottom: 4 }}>
          {m.baseUrl}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: 10 }}>
          模型：{m.model}
          {m.note ? ` · ${m.note}` : ''}
        </div>

        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            className="btn sm"
            disabled={!usable || isActive}
            onClick={() => void selectModel(m.id)}
            title={!usable ? '本地模型需要先连接成功' : ''}
          >
            {isActive ? '已选中' : '设为当前模型'}
          </button>

          {/* 已连接的本地模型 → 显示「断开」；未连接 → 显示「连接」 */}
          {isLocal && m.available ? (
            <button
              className="btn sm danger"
              data-testid={`disconnect-${m.id}`}
              disabled={probing === m.id}
              onClick={() => void doDisconnect(m)}
              title="断开连接，断开后该模型不再出现在对话页"
            >
              {probing === m.id ? '断开中…' : '断开连接'}
            </button>
          ) : (
            <button
              className="btn sm"
              data-testid={`connect-${m.id}`}
              disabled={probing === m.id}
              onClick={() => void doProbe(m)}
            >
              {probing === m.id ? '连接中…' : isLocal ? '连接' : '测试'}
            </button>
          )}

          {m.provider === 'custom' && (
            <button className="btn sm danger" onClick={() => void removeModel(m.id)}>
              删除
            </button>
          )}
        </div>

        <ModelConfig model={m} onSaved={refreshModels} />
        {/* 已连接的本地模型：显示连接时间 */}
        {isLocal && m.available && m.connectedAt && (
          <div style={{ fontSize: 10.5, color: 'var(--text-4)', marginTop: 8 }}>
            连接于 {new Date(m.connectedAt).toLocaleString('zh-CN')}
          </div>
        )}

        {res && (
          <div
            style={{
              fontSize: 11.5,
              marginTop: 8,
              color: res.ok ? 'var(--ok)' : 'var(--err)'
            }}
          >
            {res.message}
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <SectionHeader
        title="模型"
        desc={
          <>
            当前使用：<b style={{ color: 'var(--accent)' }}>{models.find((m) => m.id === activeModelId)?.name ?? '未选择'}</b>
            。本地部署的模型必须先在这里连接成功，才会出现在对话页的模型选择器里。
          </>
        }
      />

      {/* API 密钥卡片已删除：密钥的填写 / 保存 / 清空统一收在「AI 与 API」卡片里 */}
      {/* API 联网 —— 按厂商分组、可折叠 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            API 联网（{keyword ? `${matchedCount}/${apiModels.length}` : apiModels.length}）
          </div>
          <div className="row" style={{ gap: 8, flexShrink: 0 }}>
            <input
              className="input"
              data-testid="model-search"
              style={{ maxWidth: 220, padding: '6px 11px', fontSize: 12 }}
              value={query}
              placeholder="搜索模型名 / 模型标识"
              onChange={(e) => setQuery(e.target.value)}
            />
            {/* 展示模式切换：小图标 / 列表 */}
            <div className="row" style={{ gap: 4, border: '1px solid var(--stroke)', borderRadius: 10, padding: 3 }}>
              <button
                className="btn sm"
                data-testid="model-view-icon"
                title="小图标展示"
                style={viewMode === 'icon' ? { background: 'var(--accent-grad)', color: '#fff' } : { background: 'transparent' }}
                onClick={() => setViewMode('icon')}
              >
                ▦
              </button>
              <button
                className="btn sm"
                data-testid="model-view-list"
                title="列表展示"
                style={viewMode === 'list' ? { background: 'var(--accent-grad)', color: '#fff' } : { background: 'transparent' }}
                onClick={() => setViewMode('list')}
              >
                ☰
              </button>
            </div>
            <button
              className="btn sm"
              data-testid="model-expand-all"
              disabled={apiGroups.length === 0}
              onClick={toggleAll}
              title={allExpanded ? '收起所有厂商分组' : '展开所有厂商分组'}
            >
              {allExpanded ? '全部收起' : '全部展开'}
            </button>
          </div>
        </div>

        {visibleGroups.length === 0 && (
          <EmptyHint testId="model-search-empty" style={{ padding: '6px 0' }}>
            {keyword ? `没有匹配「${query.trim()}」的模型` : '还没有可用的 API 模型'}
          </EmptyHint>
        )}

        {/* 小图标模式：所有 API 模型整体平铺，不按厂商分组 */}
        {viewMode === 'icon' && visibleGroups.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }} data-testid="model-icon-grid">
            {apiModels.filter(matchKeyword).map(renderCard)}
          </div>
        )}

        {/* 列表模式：按厂商分组折叠 */}
        {viewMode === 'list' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {visibleGroups.map(({ provider, items }) => {
            const open = isGroupOpen(provider)
            return (
              <div
                key={provider}
                data-testid={`model-group-${provider}`}
                data-provider-group={provider}
                data-group-open={open}
                className="card"
                style={{ padding: 0, overflow: 'hidden', background: 'var(--glass)', border: '1px solid var(--stroke)' }}
              >
                {/* 厂商头：名称 + 模型数 + 展开/收起箭头 */}
                <button
                  type="button"
                  data-testid={`model-group-toggle-${provider}`}
                  className="row"
                  aria-expanded={open}
                  onClick={() => toggleGroup(provider)}
                  style={{
                    width: '100%',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '11px 14px',
                    background: 'transparent',
                    textAlign: 'left'
                  }}
                >
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{providerLabel(provider)}</span>
                    <span
                      className="chip"
                      style={{
                        flexShrink: 0,
                        fontSize: 10.5,
                        lineHeight: 1.6,
                        padding: '0 8px',
                        borderRadius: 999,
                        border: '1px solid var(--stroke)',
                        color: 'var(--text-3)'
                      }}
                    >
                      {items.length}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    style={{
                      fontSize: 12,
                      color: 'var(--text-4)',
                      flexShrink: 0,
                      display: 'inline-block',
                      transition: 'transform 180ms var(--ease)',
                      transform: open ? 'rotate(0deg)' : 'rotate(-90deg)'
                    }}
                  >
                    ▾
                  </span>
                </button>

                {open && (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      padding: '0 12px 12px'
                    }}
                  >
                    {items.map(renderCard)}
                  </div>
                )}
              </div>
            )
          })}
          </div>
        )}
      </div>

      {/* 本地部署 —— 默认收起，点标题展开 */}
      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <button
          type="button"
          data-testid="local-models-toggle"
          className="row"
          onClick={() => setLocalOpen((v) => !v)}
          style={{ width: '100%', justifyContent: 'space-between', gap: 10, background: 'transparent', border: 'none', textAlign: 'left' }}
        >
          <div className="card-title" style={{ marginBottom: 0 }}>
            本地部署（{connectedLocal.length}/{localModels.length} 已连接）
          </div>
          <span style={{ fontSize: 12, color: 'var(--text-4)' }}>{localOpen ? '收起 ▲' : '展开 ▼'}</span>
        </button>
        {localOpen && (
          <>
            <div className="row" style={{ justifyContent: 'flex-end', margin: '10px 0 12px' }}>
              {connectedLocal.length > 0 && (
                <button
                  className="btn sm danger"
                  data-testid="disconnect-all"
                  onClick={() => void disconnectAllModels()}
                  title="断开所有本地模型的连接"
                >
                  全部断开
                </button>
              )}
            </div>
            <div className="field-hint" style={{ marginBottom: 12 }}>
              先在本地启动推理服务（Ollama / LM Studio / vLLM / llama.cpp），再点「连接」。连接成功后该模型才会出现在对话页。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{localModels.map(renderCard)}</div>
          </>
        )}
      </div>

      {/* 添加自定义 */}
      <div className="card card-pad">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            自定义模型
          </div>
          <button className="btn sm" onClick={() => setAdding((v) => !v)}>
            {adding ? '收起' : '＋ 添加'}
          </button>
        </div>

        {adding && (
          <>
            <Field label="显示名">
              <input
                className="input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="我的模型"
              />
            </Field>
            <Field label="类型">
              <div className="row" style={{ gap: 8 }}>
                {(['api', 'local'] as const).map((k) => (
                  <button
                    key={k}
                    data-add-kind={k}
                    className="btn sm"
                    style={
                      draft.kind === k
                        ? { background: 'var(--accent-grad)', color: '#fff', borderColor: 'transparent' }
                        : undefined
                    }
                    onClick={() => setDraft({ ...draft, kind: k })}
                  >
                    {k === 'api' ? 'API 联网' : '本地部署'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Base URL">
              <input
                className="input"
                value={draft.baseUrl}
                onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                placeholder="http://127.0.0.1:11434/v1"
              />
            </Field>
            <Field label="此模型的 API Key"><input className="input" type="password" autoComplete="off" value={draft.apiKey} onChange={e => setDraft({ ...draft, apiKey: e.target.value })} /></Field>
            <Field label="模型标识">
              <input
                className="input"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder="qwen2.5:7b"
              />
            </Field>
            <button className="btn primary" onClick={() => void doAdd()}>
              添加
            </button>
          </>
        )}

        {!adding && (
          <div className="field-hint">
            任何 OpenAI 兼容端点都可以加进来，比如自建的 One-API、FastChat、或者公司内网模型服务。
          </div>
        )}
      </div>
    </>
  )
}
