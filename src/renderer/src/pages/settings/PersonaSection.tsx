import React from 'react'
import { useApp } from '../../store/AppStore'
import Affinity from '../../components/Affinity'
import { useRelationship } from '../../hooks/useRelationship'

export default function PersonaSection(): React.ReactElement | null {
  const { character } = useApp()
  const { relationship, error } = useRelationship()
  if (!character) return null
  return <div className="character-profile" data-testid="character-profile">
    <h3>{character.name} · 角色资料</h3>
    <dl><dt>身份</dt><dd>{relationship?.identity || character.name}</dd>
      <dt>相处方式</dt><dd>{relationship?.traits.join(' ') || '随共同经历慢慢了解彼此。'}</dd>
      <dt>角色文件夹</dt><dd>{relationship?.source || '自定义角色'}</dd>
      <dt>角色资料</dt><dd>{relationship?.files ?? 0} 份 · 独立绑定</dd>
    </dl>
    <Affinity />
    <h3>{relationship?.period ?? '此刻'}的问候</h3>
    <blockquote>{relationship?.greeting || character.greeting}</blockquote>
    {error && <p role="alert">{error}</p>}
  </div>
}
