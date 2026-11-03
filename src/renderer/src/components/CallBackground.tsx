import React from 'react'
import { toLocalUrl } from '../utils/localUrl'
import type { VoiceCallConfig } from '../../../shared/types'

export default function CallBackground({ config, characterId, fallback }: { config?: VoiceCallConfig; characterId?: string; fallback?: string }): React.ReactElement | null {
  const choice = characterId ? config?.backgroundByCharacter?.[characterId] : undefined
  const path = choice ? choice.path || fallback : config?.backgroundPath || fallback
  if (!path) return null
  const url = toLocalUrl(path)
  if ((choice?.path && choice.kind === 'video') || (!choice && config?.backgroundPath && config.backgroundKind === 'video')) {
    return <video className="live-call-background" src={url} autoPlay muted loop playsInline />
  }
  return <div className="live-call-background" style={{ backgroundImage: `url("${url}")` }} />
}
