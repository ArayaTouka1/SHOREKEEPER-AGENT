import React from 'react'
import { Heart, Clock3, RotateCcw } from 'lucide-react'
import { useRelationship } from '../hooks/useRelationship'
import './affinity.css'

export default function Affinity({ compact = false }: { compact?: boolean }): React.ReactElement | null {
  const { relationship: value, error } = useRelationship()
  const [resetting, setResetting] = React.useState(false)
  const [failure, setFailure] = React.useState('')
  if (!value) return error ? <span role="alert">{error}</span> : null
  if (compact) return <div className="affinity-badge" data-testid="affinity-badge" title={value.summary}><Heart size={15} /><span>{value.stage}</span></div>
  const reset = async (): Promise<void> => {
    if (!window.confirm('重置当前角色的好感进度？聊天记录和其他角色不会改变。')) return
    setResetting(true); setFailure('')
    try {
      const result = await window.aimis.relationship.reset(value.characterId)
      if (!result.ok) throw new Error(result.error)
      window.dispatchEvent(new Event('relationship-changed'))
    } catch (e) { setFailure(String(e)) }
    finally { setResetting(false) }
  }
  return <section className="affinity-panel" data-testid="affinity-panel">
    <div className="affinity-heading"><Heart size={20} /><h3>与你的羁绊</h3>
      <button className="icon-btn" title="重置当前角色好感" aria-label="重置当前角色好感" disabled={resetting} onClick={() => void reset()}><RotateCcw size={16} /></button>
    </div>
    <p>{value.summary}</p>
    {/* 只显示当前阶段名（从「陌生」位置开始，好感度满了自动替换成下一阶段），不再罗列 5 个阶段标签 */}
    <div className="affinity-stages" data-testid="affinity-current-stage">
      <span aria-current="step">{value.stage}</span>
    </div>
    <progress aria-label="当前关系阶段进度" max={100} value={value.progress} />
    <div className="affinity-details"><span>{value.nextStage ? '下一阶段 · ' + value.nextStage : '深厚羁绊'}</span><span><Clock3 size={14} />{value.period}</span></div>
    {failure && <p role="alert">{failure}</p>}
  </section>
}
