import React from 'react'
import { normalizeStoredUrl } from '../utils/localUrl'

export default function Avatar({
  src,
  size = 44,
  online = false,
  ring = false
}: {
  src?: string
  size?: number
  online?: boolean
  ring?: boolean
}): React.ReactElement {
  const url = normalizeStoredUrl(src)
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        position: 'relative',
        flexShrink: 0,
        background: 'var(--glass-hover)',
        boxShadow: ring ? '0 0 0 2px rgba(244,163,200,0.75), 0 10px 26px rgba(190,150,190,0.34)' : 'none'
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--accent-grad)' }} />
      )}
      {online && (
        <span
          style={{
            position: 'absolute',
            right: -1,
            bottom: -1,
            width: Math.max(9, size * 0.2),
            height: Math.max(9, size * 0.2),
            borderRadius: '50%',
            background: 'var(--ok)',
            border: '2px solid #fff',
            boxShadow: '0 0 8px var(--ok)'
          }}
        />
      )}
    </div>
  )
}
