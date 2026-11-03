import React, { useState } from 'react'
import type { ToolCallRecord, ToolPermissionState } from '../../../../shared/types'

const STATE_MAP: Record<ToolPermissionState, { label: string; cls: string }> = {
  idle: { label: '待命', cls: '' },
  waiting: { label: '等待授权', cls: 'waiting' },
  running: { label: '正在处理', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '执行失败', cls: 'failed' },
  denied: { label: '已拒绝', cls: 'denied' }
}

function StatusInline({ state }: { state: ToolPermissionState }): React.ReactElement {
  const status = STATE_MAP[state] ?? STATE_MAP.idle
  return <span className={`status-pill ${status.cls}`} style={{ fontSize: 11, padding: '3px 10px' }}><span className="status-dot" />{status.label}</span>
}

export function ToolCard({ tool }: { tool: ToolCallRecord }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const done = tool.state === 'done'
  return (
    <div className="card fade-in" style={{ padding: '14px 16px', marginBottom: 12, background: 'var(--bubble-tool)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--text-3)', letterSpacing: '0.04em' }}>工具操作</div>
        <StatusInline state={tool.state} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {done && <span style={{ color: 'var(--ok)', fontSize: 14 }}>✓</span>}
        <span style={{ fontSize: 15, fontWeight: 500 }}>{tool.actionLabel || tool.displayName}</span>
      </div>
      <div className="mono" style={{ color: 'var(--text-4)', marginTop: 2 }}>{tool.name}</div>
      {tool.summary && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8 }}>{tool.summary}</div>}
      {tool.error && <div style={{ fontSize: 12, color: 'var(--err)', marginTop: 8 }}>{tool.error}</div>}
      {tool.result != null && <>
        <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setOpen((value) => !value)}>{open ? '收起原始返回' : '查看原始返回'}</button>
        {open && <pre className="mono" style={{ marginTop: 8, padding: 12, borderRadius: 12, background: 'var(--glass)', border: '1px solid var(--stroke)', color: 'var(--text-2)', maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', userSelect: 'text' }}>{JSON.stringify(tool.result, null, 2)}</pre>}
      </>}
    </div>
  )
}

export function ApprovalCard({ tool, onDecide }: { tool: ToolCallRecord; onDecide: (approved: boolean) => void }): React.ReactElement {
  const target = String(tool.params.appName ?? tool.params.path ?? tool.displayName)
  return (
    <div className="card fade-in" style={{ padding: '16px 18px', marginBottom: 14, background: 'var(--glass-strong)', border: '1px solid var(--warn)', boxShadow: 'var(--shadow-card)' }}>
      <div style={{ fontSize: 12, color: 'var(--warn)', letterSpacing: '0.04em', marginBottom: 8 }}>需要你的允许</div>
      <div style={{ fontSize: 15, marginBottom: 4 }}>{tool.actionLabel}</div>
      <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 4 }}>准备调用：<span style={{ color: 'var(--text-1)' }}>{target}</span></div>
      <div style={{ fontSize: 12, color: 'var(--text-4)', marginBottom: 14 }}>{tool.description}</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn danger" style={{ flex: 1 }} onClick={() => onDecide(false)}>拒绝</button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => onDecide(true)}>允许一次</button>
      </div>
    </div>
  )
}
