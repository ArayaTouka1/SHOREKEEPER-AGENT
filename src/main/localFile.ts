import { app, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'

/**
 *
 *
 */

const allowedRoots: string[] = []

const allowedFiles = new Set<string>()

export function allowRoot(dir: string): void {
  const d = dir.replace(/[\\/]+$/, '')
  if (d && !allowedRoots.includes(d)) allowedRoots.push(d)
}

/**
 *
 */
export function allowFile(p: string): void {
  if (!p) return
  const norm = p.replace(/\//g, require('node:path').sep).toLowerCase()
  allowedFiles.add(norm)
  if (allowedFiles.size > 500) {
    const first = allowedFiles.values().next().value
    if (first) allowedFiles.delete(first)
  }
}

export function allowFiles(paths: string[]): void {
  for (const p of paths) allowFile(p)
}

export function registerAppFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'appfile',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true
      }
    }
  ])
}

export function installAppFileProtocol(): void {
  allowRoot(app.getPath('userData'))
  if (process.resourcesPath) allowRoot(process.resourcesPath)
  if (app.getAppPath()) allowRoot(app.getAppPath())

  protocol.handle('appfile', (req) => {
    try {
      const url = new URL(req.url)
      const host = url.hostname ? decodeURIComponent(url.hostname) : ''
      let raw = decodeURIComponent(url.pathname)

      if (/^[a-zA-Z]$/.test(host)) {
        raw = host.toUpperCase() + ':' + raw
      } else if (/^[a-zA-Z]:$/.test(host)) {
        raw = host.toUpperCase() + raw
      } else if (host && host !== 'localhost') {
        raw = '/' + host + raw
      }

      if (/^\/[A-Za-z]:/.test(raw)) raw = raw.slice(1)
      raw = raw.replace(/^\/+/, '')

      const path = require('node:path')
      const full = path.normalize(raw.replace(/\//g, path.sep))

      const norm = full.toLowerCase().replace(/[\\/]+$/, '')
      const inDir = allowedRoots.some((root) => {
        const r = root.replace(/\//g, path.sep).toLowerCase().replace(/[\\/]+$/, '')
        return norm === r || norm.startsWith(r + path.sep)
      })
      if (!inDir && !allowedFiles.has(norm)) {
        return new Response('forbidden', { status: 403 })
      }

      if (!require('node:fs').existsSync(full)) {
        return new Response('not found', { status: 404 })
      }

      return net.fetch(pathToFileURL(full).toString(), { headers: req.headers })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

export function toAppFileUrl(p: string): string {
  if (!p) return ''
  if (/^(data:|https?:|appfile:)/i.test(p)) return p
  const norm = p.replace(/\\/g, '/')
  return 'appfile:///' + (norm.startsWith('/') ? norm.slice(1) : norm)
}
