import React, { useMemo, useState } from 'react'
import { useApp } from '../store/AppStore'
import { Collapsible, EmptyHint } from '../components/ui'
import type { MemoryKind } from '../../../shared/types'

/* ------------------------------------------------------------------ *
 *  ------------------------------------------------------------------
 * ------------------------------------------------------------------ */

const VISIBLE_KINDS: MemoryKind[] = ['event', 'preference', 'summary']

const KIND_LABEL: Record<string, string> = {
  event: '事件',
  preference: '偏好',
  summary: '摘要'
}

const KIND_COLOR: Record<string, string> = {
  event: 'var(--ok)',
  preference: '#fbbf24',
  summary: '#94a3b8'
}

const LEGACY_KIND: Record<string, MemoryKind> = { fact: 'event' }

const normalizeKind = (k: MemoryKind): MemoryKind | null => {
  if (k === 'seed') return null
  return LEGACY_KIND[k] ?? k
}

const kindLabel = (k: MemoryKind): string => KIND_LABEL[k] ?? '记忆'
const kindColor = (k: MemoryKind): string => KIND_COLOR[k] ?? 'var(--text-4)'

export default function MemoryPage(): React.ReactElement {
  const { character, memories, addMemory, deleteMemory, refreshMemories } = useApp()
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<MemoryKind | 'all'>('all')

  const filtered = useMemo(() => {
    let list = memories.filter((m) => normalizeKind(m.kind) !== null)
    if (kindFilter !== 'all') list = list.filter((m) => normalizeKind(m.kind) === kindFilter)
    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((m) => m.text.toLowerCase().includes(q))
    }
    return list
  }, [memories, kindFilter, query])

  const stats = useMemo(() => {
    const byKind: Record<string, number> = {}
    for (const m of memories) {
      const k = normalizeKind(m.kind)
      if (!k) continue
      byKind[k] = (byKind[k] ?? 0) + 1
    }
    return byKind
  }, [memories])

  const visibleCount = useMemo(() => Object.values(stats).reduce((a, b) => a + b, 0), [stats])

  const groups = useMemo(() => {
    const order: MemoryKind[] = [...VISIBLE_KINDS]
    for (const m of filtered) {
      const k = normalizeKind(m.kind)
      if (k && !order.includes(k)) order.push(k)
    }
    return order
      .map((kind) => ({ kind, items: filtered.filter((m) => normalizeKind(m.kind) === kind) }))
      .filter((g) => g.items.length > 0)
  }, [filtered])

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await addMemory(text, 0.8)
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-crumb">记忆 / {character?.name ?? '角色'}</div>
          <div className="page-title">{character?.name ?? '她'}记得的事</div>
        </div>
        <button className="btn sm" data-testid="memory-refresh" onClick={() => void refreshMemories()}>
          刷新
        </button>
      </div>

      <div className="page-body">
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 32px 32px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 概览：默认折叠 */}
            <Collapsible title="记忆概览" count={visibleCount} testId="memory-overview">
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                  gap: 14,
                  paddingTop: 4
                }}
              >
                {VISIBLE_KINDS.map((k) => (
                  <div key={k} className="card card-pad" style={{ padding: '14px 16px' }}>
                    <div style={{ fontSize: 11, color: kindColor(k), letterSpacing: '0.06em', marginBottom: 6 }}>
                      {kindLabel(k)}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 500 }}>{stats[k] ?? 0}</div>
                  </div>
                ))}
              </div>
            </Collapsible>

            {/* 写入：默认折叠 */}
            <Collapsible title="写入一条长期记忆" testId="memory-compose">
              <div className="row" style={{ alignItems: 'flex-start', paddingTop: 4 }}>
                <textarea
                  className="input grow"
                  data-testid="memory-draft"
                  style={{ minHeight: 66 }}
                  placeholder="比如：我每天早上八点开始工作 / 我喜欢安静的歌 / 我的显卡是 RTX 4060"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button
                  className="btn primary"
                  data-testid="memory-add"
                  onClick={() => void submit()}
                  disabled={!draft.trim()}
                >
                  记住
                </button>
              </div>
              <div className="field-hint" style={{ marginTop: 8 }}>
                对话里说出「我叫…」「我喜欢…」「记住…」这类句子时，{character?.name ?? '她'}也会自动记下来。
              </div>
            </Collapsible>

            {/* 记忆列表：本页主内容，默认展开 */}
            <Collapsible title="记忆列表" count={filtered.length} defaultOpen testId="memory-list">
              <div className="row" style={{ marginBottom: 14, gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
                <input
                  className="input"
                  data-testid="memory-search"
                  style={{ maxWidth: 260, padding: '7px 12px', fontSize: 12 }}
                  placeholder="搜索记忆..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  className={`btn sm ${kindFilter === 'all' ? 'primary' : ''}`}
                  data-testid="memory-filter-all"
                  onClick={() => setKindFilter('all')}
                >
                  全部 {visibleCount}
                </button>
                {VISIBLE_KINDS.filter((k) => stats[k]).map((k) => (
                  <button
                    key={k}
                    className={`btn sm ${kindFilter === k ? 'primary' : ''}`}
                    data-testid={`memory-filter-${k}`}
                    onClick={() => setKindFilter(k)}
                  >
                    {kindLabel(k)} {stats[k]}
                  </button>
                ))}
              </div>

              {groups.length === 0 && (
                <div className="card card-pad" style={{ textAlign: 'center' }}>
                  <EmptyHint testId="memory-empty">
                    {visibleCount === 0
                      ? '还没有记忆。上面写入一条，或者聊天时告诉她一些关于你的事。'
                      : '还没有匹配的记忆'}
                  </EmptyHint>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {groups.map((g) => (
                  <Collapsible
                    key={g.kind}
                    title={kindLabel(g.kind)}
                    count={g.items.length}
                    defaultOpen
                    testId={`memory-group-${g.kind}`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 2 }}>
                      {g.items.map((m) => (
                        <div
                          key={m.id}
                          className="card"
                          data-testid={`memory-item-${m.id}`}
                          style={{ padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}
                        >
                          <div
                            style={{
                              width: 4,
                              alignSelf: 'stretch',
                              borderRadius: 2,
                              background: kindColor(g.kind),
                              opacity: 0.75,
                              flexShrink: 0
                            }}
                          />
                          <div className="grow">
                            <div className="row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 11, color: kindColor(g.kind), letterSpacing: '0.05em' }}>
                                {kindLabel(g.kind)}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-4)' }}>
                                权重 {m.weight.toFixed(2)} · 命中 {m.hits} 次 ·{' '}
                                {new Date(m.createdAt).toLocaleString('zh-CN')}
                              </span>
                            </div>
                            <div style={{ fontSize: 14, lineHeight: 1.7, userSelect: 'text' }}>{m.text}</div>
                          </div>
                          <button
                            className="btn ghost sm danger"
                            data-testid={`memory-delete-${m.id}`}
                            onClick={() => void deleteMemory(m.id)}
                            title="删除"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  </Collapsible>
                ))}
              </div>
            </Collapsible>
          </div>
        </div>
      </div>
    </>
  )
}
