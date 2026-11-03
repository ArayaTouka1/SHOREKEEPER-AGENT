/**
 *
 */

export function toLocalUrl(p: string | undefined | null): string {
  if (!p) return ''
  if (/^(data:|https?:|appfile:|blob:)/i.test(p)) return p
  if (/^file:\/\//i.test(p)) return normalizeStoredUrl(p)
  const norm = String(p).replace(/\\/g, '/')
  return 'appfile:///' + (norm.startsWith('/') ? norm.slice(1) : norm).split('/').map(encodeURIComponent).join('/').replace(/^([A-Za-z])%3A/, '$1:')
}

export function normalizeStoredUrl(p: string | undefined | null): string {
  if (!p) return ''
  if (/^file:\/\//i.test(p)) {
    const raw = p.replace(/^file:\/\/\/?/i, '')
    return toLocalUrl(raw)
  }
  return toLocalUrl(p)
}
