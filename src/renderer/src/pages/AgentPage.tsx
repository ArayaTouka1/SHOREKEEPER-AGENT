import React, { useEffect, useMemo, useState } from 'react'
import { useApp } from '../store/AppStore'
import Avatar from '../components/Avatar'
import PermissionBadge from '../components/PermissionBadge'
import RunningAppsPanel from '../components/RunningAppsPanel'
import FileWorkspace from '../components/FileWorkspace'
import { Collapsible, EmptyHint } from '../components/ui'
import type { AgentToolSpec, ToolPermissionState } from '../../../shared/types'

interface LogEntry {
  name: string
  state: ToolPermissionState
  summary: string
  at: number
}

const CATEGORY_LABEL: Record<AgentToolSpec['category'], string> = {
  fs: '文件系统',
  shell: '终端',
  web: '网络',
  plan: '规划',
  interaction: '交互',
  agent: '代理与扩展',
  system: '任务管理'
}

const CATEGORY_ICON: Record<AgentToolSpec['category'], string> = {
  fs: '▤',
  shell: '▶',
  web: '◍',
  plan: '☰',
  interaction: '◇',
  agent: '❖',
  system: '⚙'
}

export default function AgentPage(): React.ReactElement {
  const {
    character,
    hardware,
    refreshHardware,
    settings,
    saveSettings,
    agentTools,
    jobs,
    refreshJobs,
    killJob,
    todos,
    refreshTodos,
    deliverables,
    refreshDeliverables,
    workspace,
    pickWorkspace,
    skills,
    refreshSkills
  } = useApp()

  const [busyTool, setBusyTool] = useState<string | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [tab, setTab] = useState<'files' | 'tools' | 'jobs' | 'plan' | 'skills'>('files')
  const [openCat, setOpenCat] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void refreshJobs()
    void refreshTodos()
    void refreshDeliverables()
    void refreshSkills()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const grouped = useMemo(() => {
    const map = new Map<AgentToolSpec['category'], AgentToolSpec[]>()
    for (const t of agentTools) {
      if (!map.has(t.category)) map.set(t.category, [])
      map.get(t.category)!.push(t)
    }
    return Array.from(map.entries())
  }, [agentTools])

  const invoke = async (name: string, params: Record<string, unknown>): Promise<void> => {
    setBusyTool(name)
    try {
      const r = await window.aimis.agent.run({ name, params })
      if (!r.ok) throw new Error(r.error ?? '执行失败')
      const data = r.data as { summary?: string }
      const doneEntry: LogEntry = { name, state: 'done', summary: data?.summary ?? '执行完成', at: Date.now() }
      setLog((l): LogEntry[] => [doneEntry, ...l].slice(0, 30))
      void refreshJobs()
    } catch (err) {
      const failEntry: LogEntry = {
        name,
        state: 'failed',
        summary: err instanceof Error ? err.message : String(err),
        at: Date.now()
      }
      setLog((l): LogEntry[] => [failEntry, ...l].slice(0, 30))
    } finally {
      setBusyTool(null)
    }
  }

  const runningJobs = jobs.filter((j) => j.status === 'running')
  const doneTodos = todos.filter((t) => t.status === 'completed').length

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-crumb">智能体 / {character?.name ?? '角色'}</div>
          <div className="page-title">协作能力</div>
        </div>
        <div className="row" style={{ gap: 10 }}>
          {runningJobs.length > 0 && (
            <span className="status-pill running">
              <span className="status-dot" />
              {runningJobs.length} 个任务运行中
            </span>
          )}
          <PermissionBadge compact />
          <span className={`status-pill ${settings && settings.agent.enabled ? 'done' : 'denied'}`}>
            <span className="status-dot" />
            {settings && settings.agent.enabled ? 'Agent 已启用' : 'Agent 已停用'}
          </span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 32px 32px' }}>
        <div className="pill-tabs" style={{ marginBottom: 18, width: 'fit-content' }}>
          {(
            [
              { k: 'files', label: '文件' },
              { k: 'tools', label: `工具（${agentTools.length}）` },
              { k: 'jobs', label: `后台任务（${jobs.length}）` },
              { k: 'plan', label: `待办（${doneTodos}/${todos.length}）` },
              { k: 'skills', label: `技能（${skills.length}）` }
            ] as const
          ).map((x) => (
            <button
              key={x.k}
              data-agent-tab={x.k}
              className={`pill-tab ${tab === x.k ? 'active' : ''}`}
              onClick={() => setTab(x.k)}
            >
              {x.label}
            </button>
          ))}
        </div>

        {tab === 'files' && <FileWorkspace />}
        <div style={{ display: tab === 'files' ? 'none' : 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 18, maxWidth: 1240 }}>
          {/* 左栏 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {tab === 'tools' && (
              <Collapsible title="Agent 工具集（对齐 DSH）" count={agentTools.length} defaultOpen testId="agent-tools">
                {grouped.map(([cat, list]) => {
                  const open = openCat[cat] !== false
                  return (
                    <div key={cat} style={{ marginBottom: 12 }}>
                      <button
                        className="row"
                        data-cat={cat}
                        style={{ width: '100%', justifyContent: 'space-between', padding: '6px 0' }}
                        onClick={() => setOpenCat((s) => ({ ...s, [cat]: !open }))}
                      >
                        <span style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.06em' }}>
                          {CATEGORY_ICON[cat]} {CATEGORY_LABEL[cat]}（{list.length}）
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-4)' }}>{open ? '▲' : '▼'}</span>
                      </button>

                      {open && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {list.map((t) => (
                            <div
                              key={t.name}
                              data-tool={t.name}
                              className="card"
                              style={{ padding: '10px 13px', background: 'var(--glass)' }}
                            >
                              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 3 }}>
                                <span style={{ fontSize: 13 }}>{t.displayName}</span>
                                <span
                                  style={{
                                    fontSize: 10,
                                    padding: '1px 8px',
                                    borderRadius: 999,
                                    border: '1px solid var(--stroke)',
                                    color: t.permission === 'always' ? 'var(--ok)' : 'var(--warn)'
                                  }}
                                >
                                  {t.permission === 'always' ? '免授权' : '需授权'}
                                </span>
                              </div>
                              <div className="mono" style={{ color: 'var(--text-4)', marginBottom: 4 }}>
                                {t.name}
                              </div>
                              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginBottom: t.params.length ? 8 : 0 }}>
                                {t.description}
                              </div>
                              {t.params.length > 0 && (
                                <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                                  {t.params.map((p) => (
                                    <span
                                      key={p.key}
                                      style={{
                                        fontSize: 10.5,
                                        padding: '1px 7px',
                                        borderRadius: 6,
                                        background: 'var(--accent-soft)',
                                        color: 'var(--text-2)'
                                      }}
                                    >
                                      {p.label}
                                      {p.required ? '*' : ''}
                                      {p.example ? ` · ${p.example}` : ''}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {t.params.length === 0 && (
                                <button
                                  className="btn sm"
                                  disabled={busyTool === t.name}
                                  onClick={() => void invoke(t.name, {})}
                                >
                                  立即执行
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
                {agentTools.length === 0 && <EmptyHint style={{ paddingTop: 4 }}>正在加载工具集…</EmptyHint>}
              </Collapsible>
            )}

            {tab === 'jobs' && (
              <Collapsible title="后台任务" count={jobs.length} defaultOpen testId="agent-jobs">
                <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button className="btn sm" data-testid="agent-jobs-refresh" onClick={() => void refreshJobs()}>
                    刷新
                  </button>
                </div>
                {jobs.length === 0 && (
                  <EmptyHint testId="agent-jobs-empty" style={{ paddingBottom: 4 }}>
                    还没有后台任务
                  </EmptyHint>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {jobs.map((j) => (
                    <Collapsible
                      key={j.id}
                      title={j.label}
                      subtitle={`${j.outputLines} 行输出 · 退出码 ${j.exitCode ?? '-'}`}
                      testId={`job-${j.id}`}
                    >
                      <div className="row" style={{ justifyContent: 'flex-start', marginBottom: 6 }} data-job={j.id}>
                        <span
                          className={`status-pill ${j.status === 'running' ? 'running' : j.status === 'completed' ? 'done' : 'failed'}`}
                          style={{ fontSize: 10.5, padding: '2px 9px' }}
                        >
                          <span className="status-dot" />
                          {j.status === 'running'
                            ? '运行中'
                            : j.status === 'completed'
                              ? '已完成'
                              : j.status === 'killed'
                                ? '已终止'
                                : '失败'}
                        </span>
                      </div>
                      <div className="mono" style={{ color: 'var(--text-4)', marginBottom: 6, wordBreak: 'break-all' }}>
                        {j.command}
                      </div>
                      {j.tail && (
                        <pre
                          className="mono"
                          style={{
                            maxHeight: 120,
                            overflow: 'auto',
                            padding: 9,
                            borderRadius: 9,
                            background: 'var(--glass)',
                            border: '1px solid var(--stroke)',
                            color: 'var(--text-2)',
                            whiteSpace: 'pre-wrap',
                            marginBottom: 8
                          }}
                        >
                          {j.tail}
                        </pre>
                      )}
                      <div className="row" style={{ gap: 8 }}>
                        <button
                          className="btn sm"
                          onClick={async () => {
                            const r = await window.aimis.agent.jobOutput({ jobId: j.id, tail: 100 })
                            if (r.ok && r.data) {
                              const d = r.data as { output: string }
                              const outEntry: LogEntry = {
                                name: j.id,
                                state: 'done',
                                summary: d.output.slice(-500),
                                at: Date.now()
                              }
                              setLog((l): LogEntry[] => [outEntry, ...l].slice(0, 30))
                            }
                          }}
                        >
                          查看输出
                        </button>
                        {j.status === 'running' && (
                          <button className="btn sm danger" onClick={() => void killJob(j.id)}>
                            终止
                          </button>
                        )}
                      </div>
                    </Collapsible>
                  ))}
                </div>
              </Collapsible>
            )}

            {tab === 'plan' && (
              <>
                <Collapsible
                  title="待办清单"
                  subtitle={`完成 ${doneTodos}/${todos.length}`}
                  count={todos.length}
                  defaultOpen
                  testId="agent-todos"
                >
                  {todos.length === 0 && (
                    <EmptyHint testId="agent-todos-empty" style={{ paddingBottom: 4 }}>
                      还没有待办。让角色做多步任务时会自动生成。
                    </EmptyHint>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {todos.map((t, i) => (
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
                </Collapsible>

                <Collapsible title="交付物" count={deliverables.length} testId="agent-deliverables">
                  <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
                    <button className="btn sm" onClick={() => void refreshDeliverables()}>
                      刷新
                    </button>
                  </div>
                  {deliverables.length === 0 && (
                    <EmptyHint testId="agent-deliverables-empty" style={{ paddingBottom: 4 }}>
                      还没有交付物
                    </EmptyHint>
                  )}
                  {deliverables.map((d) => (
                    <div
                      key={d.id}
                      className="row"
                      style={{ justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--stroke)' }}
                    >
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="truncate" style={{ fontSize: 13 }}>
                          {d.name}
                        </div>
                        <div className="truncate" style={{ fontSize: 11, color: 'var(--text-4)' }} title={d.path}>
                          {d.path}
                        </div>
                      </div>
                      <button
                        className="btn sm"
                        onClick={() => void window.aimis.system.openExternal('file:///' + d.path.replace(/\\/g, '/'))}
                      >
                        打开
                      </button>
                    </div>
                  ))}
                </Collapsible>
              </>
            )}

            {tab === 'skills' && (
              <Collapsible title="技能包" count={skills.length} defaultOpen testId="agent-skills">
                <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
                  <button className="btn sm" onClick={() => void refreshSkills()}>
                    刷新
                  </button>
                </div>
                <div className="field-hint" style={{ marginBottom: 12 }}>
                  把 SKILL.md 放进 <span className="mono">%APPDATA%/shorekeeper-agent/skills/技能名/</span> 就能被识别。
                </div>
                {skills.length === 0 && (
                  <EmptyHint testId="agent-skills-empty" style={{ paddingBottom: 4 }}>
                    还没有技能包
                  </EmptyHint>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {skills.map((s) => (
                    <div key={s.path} className="card" style={{ padding: '11px 14px', background: 'var(--glass)' }}>
                      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 13 }}>{s.name}</span>
                        <span style={{ fontSize: 10, color: s.builtin ? 'var(--info)' : 'var(--ok)' }}>
                          {s.builtin ? '内置' : '自定义'}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{s.description || '（无描述）'}</div>
                    </div>
                  ))}
                </div>
              </Collapsible>
            )}
          </div>

          {/* 右栏 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Collapsible title="工作区" defaultOpen testId="agent-workspace">
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 8 }}>
                <button className="btn ghost sm" data-testid="agent-workspace-pick" onClick={() => void pickWorkspace()}>
                  切换
                </button>
              </div>
              <div className="mono truncate" style={{ color: 'var(--text-2)', marginBottom: 8 }} title={workspace}>
                {workspace || '（未设置）'}
              </div>
              <div className="field-hint">Agent 的文件操作与命令都限制在这个目录内。</div>
            </Collapsible>

            {/* 已启动的应用：可以在这里把它们关掉 */}
            <Collapsible title="已启动的应用" testId="agent-running-apps">
              <RunningAppsPanel />
            </Collapsible>

            <Collapsible title="本机快照" testId="agent-hardware">
              <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
                <button className="btn ghost sm" data-testid="agent-hardware-refresh" onClick={() => void refreshHardware()}>
                  刷新
                </button>
              </div>
              {hardware ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                  <KV k="CPU" v={`${hardware.snapshot.cpu.name} · ${hardware.snapshot.cpu.cores} 核`} />
                  <KV k="负载" v={`${hardware.snapshot.cpu.loadPercent}%`} />
                  <KV
                    k="内存"
                    v={`${hardware.snapshot.memory.usedGB}G / ${hardware.snapshot.memory.totalGB}G（${hardware.snapshot.memory.usedPercent}%）`}
                  />
                  <KV
                    k="显卡"
                    v={
                      hardware.snapshot.gpu
                        ? `${hardware.snapshot.gpu.name} · ${hardware.snapshot.gpu.temperatureC ?? '?'}℃`
                        : '无独显读数'
                    }
                  />
                  <KV k="主机" v={hardware.snapshot.os.hostname} />
                </div>
              ) : (
                <EmptyHint style={{ paddingBottom: 4 }}>正在读取……</EmptyHint>
              )}
            </Collapsible>

            <Collapsible title="授权策略" testId="agent-permission">
              <div className="switch-row">
                <div className="switch-row-text">
                  <span className="switch-row-title">启用本机工具</span>
                  <span className="switch-row-desc">关闭后所有工具调用都会被拒绝</span>
                </div>
                <button
                  className={`switch ${settings && settings.coop.enabled ? 'on' : ''}`}
                  onClick={() =>
                    settings && void saveSettings({ coop: { ...settings.coop, enabled: !settings.coop.enabled } })
                  }
                />
              </div>
              <div className="switch-row">
                <div className="switch-row-text">
                  <span className="switch-row-title">每次操作都需授权</span>
                  <span className="switch-row-desc">读取类工具默认免授权，写操作始终需要</span>
                </div>
                <button
                  className={`switch ${settings && settings.coop.requireApproval ? 'on' : ''}`}
                  onClick={() =>
                    settings &&
                    void saveSettings({ coop: { ...settings.coop, requireApproval: !settings.coop.requireApproval } })
                  }
                />
              </div>
            </Collapsible>

            <Collapsible title="调用日志" count={log.length} testId="agent-log">
              <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {log.length === 0 && (
                  <EmptyHint testId="agent-log-empty" style={{ paddingBottom: 4 }}>
                    还没有调用记录
                  </EmptyHint>
                )}
                {log.map((l, i) => (
                  <div key={i} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ color: l.state === 'done' ? 'var(--ok)' : 'var(--err)' }}>
                      {l.state === 'done' ? '✓' : '✗'}
                    </span>
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="mono" style={{ color: 'var(--text-3)' }}>
                        {l.name}
                      </div>
                      <div style={{ color: 'var(--text-4)', wordBreak: 'break-word' }}>{l.summary.slice(0, 200)}</div>
                    </div>
                    <span style={{ color: 'var(--text-4)', fontSize: 10 }}>{new Date(l.at).toLocaleTimeString('zh-CN')}</span>
                  </div>
                ))}
              </div>
            </Collapsible>

            <div className="card card-pad" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Avatar src={character?.avatar.main} size={38} online />
              <div>
                <div style={{ fontSize: 13 }}>{character?.name ?? '角色'} · 协作代理</div>
                <div style={{ fontSize: 11, color: 'var(--text-4)' }}>
                  {agentTools.length} 个工具 · {skills.length} 个技能
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function KV({ k, v }: { k: string; v: string }): React.ReactElement {
  return (
    <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--text-4)', flexShrink: 0 }}>{k}</span>
      <span className="truncate" style={{ textAlign: 'right' }} title={v}>
        {v}
      </span>
    </div>
  )
}
