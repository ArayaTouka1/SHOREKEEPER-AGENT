import React, { useEffect, useMemo } from 'react'
import { useApp } from '../store/AppStore'
import { Collapsible, EmptyHint } from '../components/ui'
import type { Route } from '../App'

export default function TaskPage({ onNavigate }: { onNavigate: (r: Route) => void }): React.ReactElement {
  const { conversations, character, memories, todos, refreshTodos } = useApp()

  useEffect(() => {
    void refreshTodos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   */
  const tasks = useMemo(
    () =>
      conversations.slice(0, 8).map((c) => ({
        id: c.id,
        title: c.title || '新对话',
        detail: c.summary || '还没有消息',
        count: c.messageCount,
        updatedAt: c.updatedAt,
        state: '已完成' as const
      })),
    [conversations]
  )

  const planItems = useMemo(() => todos.map((t) => ({ content: t.content, status: t.status })), [todos])
  const doneTodos = planItems.filter((t) => t.status === 'completed').length
  const total = tasks.length + planItems.length

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-crumb">任务</div>
          <div className="page-title">和{character?.name ?? '她'}一起完成</div>
        </div>
        <span className={`status-pill ${total > 0 ? 'done' : 'waiting'}`}>
          <span className="status-dot" />
          {total > 0 ? `${total} 项记录` : '暂无任务'}
        </span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '24px 32px 32px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1240 }}>
          {/* 待办：智能体规划出来的多步任务 */}
          <Collapsible
            title="待办清单"
            subtitle={planItems.length ? `完成 ${doneTodos}/${planItems.length}` : undefined}
            count={planItems.length}
            defaultOpen
            testId="task-todos"
          >
            {planItems.length === 0 ? (
              <EmptyHint testId="task-todos-empty" style={{ paddingTop: 4 }}>
                还没有待办。让{character?.name ?? '她'}做多步任务时会自动生成。
              </EmptyHint>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4 }}>
                {planItems.map((t, i) => (
                  <div key={i} className="row" style={{ gap: 9, fontSize: 13 }}>
                    <span
                      style={{
                        color:
                          t.status === 'completed'
                            ? 'var(--ok)'
                            : t.status === 'in_progress'
                              ? 'var(--info)'
                              : 'var(--text-4)'
                      }}
                    >
                      {t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '◐' : '☐'}
                    </span>
                    <span
                      style={{
                        textDecoration: t.status === 'completed' ? 'line-through' : 'none',
                        color: t.status === 'completed' ? 'var(--text-4)' : 'var(--text-1)'
                      }}
                    >
                      {t.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Collapsible>

          {/* 对话任务：本页主内容，默认展开 */}
          <Collapsible title="对话任务" count={tasks.length} defaultOpen testId="task-list">
            {tasks.length === 0 ? (
              <EmptyHint testId="task-empty" style={{ paddingTop: 4 }}>
                还没有任何任务记录。去对话页和{character?.name ?? '她'}聊点什么，这里会自动出现。
              </EmptyHint>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
                {tasks.map((t) => (
                  <Collapsible
                    key={t.id}
                    title={t.title}
                    subtitle={`${t.count} 条消息`}
                    testId={`task-item-${t.id}`}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 2 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: 'var(--text-4)' }}>对话任务</span>
                        <span className="status-pill done" style={{ fontSize: 11, padding: '2px 9px' }}>
                          <span className="status-dot" />
                          {t.state}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6 }}>{t.detail}</div>
                      <div
                        className="row"
                        style={{ justifyContent: 'space-between', fontSize: 11, color: 'var(--text-4)', marginTop: 4 }}
                      >
                        <span>{t.count} 条消息</span>
                        <span>{new Date(t.updatedAt).toLocaleString('zh-CN')}</span>
                      </div>
                      <div className="row" style={{ gap: 8, marginTop: 4 }}>
                        <button
                          className="btn sm"
                          data-testid={`task-open-${t.id}`}
                          onClick={() => onNavigate('chat')}
                        >
                          继续这个任务
                        </button>
                        <button className="btn sm ghost" onClick={() => onNavigate('memory')}>
                          查看记忆
                        </button>
                      </div>
                    </div>
                  </Collapsible>
                ))}
              </div>
            )}
          </Collapsible>

          {/* 系统任务：只统计，默认折叠 */}
          <Collapsible title="系统任务" count={memories.length + conversations.length} testId="task-system">
            <div style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.7, paddingTop: 4 }}>
              已固化 {memories.length} 条长期记忆，{conversations.length} 个会话。
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12 }}>
              <button className="btn sm" data-testid="task-goto-memory" onClick={() => onNavigate('memory')}>
                查看记忆
              </button>
              <button className="btn sm" data-testid="task-goto-agent" onClick={() => onNavigate('agent')}>
                查看智能体
              </button>
            </div>
          </Collapsible>
        </div>
      </div>
    </>
  )
}
