import React, { useEffect, useState } from 'react'
import { ShieldCheck, Check, X } from 'lucide-react'

type Request = { id: string; workspace: string; name: string; params: Record<string, unknown> }
export default function OperationApproval(): React.ReactElement | null {
  const [requests, setRequests] = useState<Request[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    const load = async (): Promise<void> => {
      const r = await window.aimis.approvals.pending()
      if (!disposed && r.ok && r.data) setRequests(r.data)
    }
    void load()
    const timer = window.setInterval(() => void load(), 500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [])
  const request = requests[0]
  if (!request) return null
  const decide = async (approved: boolean): Promise<void> => {
    const r = await window.aimis.approvals.decide(request.id, approved)
    if (!r.ok) setError(r.error || '操作失败')
    else setRequests(list => list.filter(item => item.id !== request.id))
  }
  return <aside role="region" aria-label="操作确认" data-testid="operation-approval" style={{ position: 'fixed', bottom: 108, right: 28, width: 'min(460px, calc(100vw - 110px))', zIndex: 190, background: 'var(--bg-base)', border: '1px solid var(--stroke-strong)', borderRadius: 8, padding: 16, boxShadow: 'var(--shadow-pop)' }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><ShieldCheck size={18} /><strong>允许这次文件操作？</strong></div>
    <div style={{ margin: '10px 0', fontSize: 13, overflowWrap: 'anywhere', maxHeight: 120, overflowY: 'auto' }}>{String(request.params.path ?? request.params.dst ?? request.params.command ?? request.name)}</div>
    {error && <div role="alert">{error}</div>}
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn sm" onClick={() => void decide(false)}><X size={16} />取消</button><button className="btn primary sm" onClick={() => void decide(true)}><Check size={16} />允许一次</button></div>
  </aside>
}
