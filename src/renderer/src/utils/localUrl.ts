/**
 *
 */

export function toLocalUrl(p: string | undefined | null): string {
  if (!p) return ''
  if (/^(data:|https?:|appfile:|blob:)/i.test(p)) return p
  const norm = String(p).replace(/\\/g, '/')
  return 'appfile:///' + (norm.startsWith('/') ? norm.slice(1) : norm)
}

export function normalizeStoredUrl(p: string | undefined | null): string {
  if (!p) return ''
  if (/^file:\/\//i.test(p)) {
    const raw = p.replace(/^file:\/\/\/?/i, '')
    return 'appfile:///' + raw.replace(/\\/g, '/')
  }
  return toLocalUrl(p)
}
