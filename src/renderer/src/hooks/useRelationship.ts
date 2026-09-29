import { useEffect, useState } from 'react'
import { useApp } from '../store/AppStore'
import type { CharacterRelationship } from '../../../shared/relationship'

export function useRelationship(): { relationship: CharacterRelationship | null; error: string } {
  const { character, messages } = useApp()
  const [relationship, setRelationship] = useState<CharacterRelationship | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    setRelationship(null)
    const refresh = (): void => {
      if (!character) return
      void window.aimis.relationship.get(character.id).then(result => {
        if (disposed) return
        if (result.ok && result.data) { setRelationship(result.data); setError('') }
        else setError(result.error || '无法读取关系状态')
      }).catch(e => { if (!disposed) setError(String(e)) })
    }
    refresh()
    const timer = window.setInterval(refresh, 60000)
    window.addEventListener('relationship-changed', refresh)
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('relationship-changed', refresh) }
  }, [character?.id, messages.length])
  return { relationship: relationship?.characterId === character?.id ? relationship : null, error }
}
