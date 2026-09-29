import React from 'react'
import type { ToolPermissionState } from '../../../shared/types'

const MAP: Record<ToolPermissionState, { label: string; cls: string }> = {
  idle: { label: '待命', cls: '' },
  waiting: { label: '等待授权', cls: 'waiting' },
  running: { label: '正在处理', cls: 'running' },
  done: { label: '已完成', cls: 'done' },
  failed: { label: '执行失败', cls: 'failed' },
  denied: { label: '已拒绝', cls: 'denied' }
}

export default function StatusPill({ state }: { state: ToolPermissionState }): React.ReactElement {
  const m = MAP[state] ?? MAP.idle
  return (
    <span className={`status-pill ${m.cls}`}>
      <span className="status-dot" />
      {m.label}
    </span>
  )
}
