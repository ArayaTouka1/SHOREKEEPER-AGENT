/**
 *
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { BackgroundMedia } from '../shared/types'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function backgroundDir(): string {
  const dir = join(app.getPath('userData'), 'backgrounds')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.m4v', '.ogv']

export function mediaKindOf(file: string): 'image' | 'video' | null {
  const ext = extname(file).toLowerCase()
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return null
}

export function listBackgrounds(): BackgroundMedia[] {
  const dir = backgroundDir()
  const out: BackgroundMedia[] = []
  try {
    for (const f of readdirSync(dir)) {
      const kind = mediaKindOf(f)
      if (!kind) continue
      const full = join(dir, f)
      let size = 0
      let mtime = Date.now()
      try {
        const st = statSync(full)
        size = st.size
        mtime = Math.round(st.mtimeMs)
      } catch {
        continue
      }
      out.push({
        id: 'bg:' + f,
        name: basename(f, extname(f)),
        kind,
        path: full,
        url: 'file:///' + full.replace(/\\/g, '/'),
        size,
        addedAt: mtime
      })
    }
  } catch {
  }
  return out.sort((a, b) => b.addedAt - a.addedAt)
}

export function importBackground(sourcePath: string): BackgroundMedia {
  const kind = mediaKindOf(sourcePath)
  if (!kind) throw new Error('只支持图片（png/jpg/webp/gif）或视频（mp4/webm/mov）')

  const dir = backgroundDir()
  const ext = extname(sourcePath).toLowerCase()
  const safe = basename(sourcePath, ext).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'background'
  let name = `${safe}${ext}`
  let n = 1
  while (existsSync(join(dir, name))) name = `${safe}_${n++}${ext}`

  copyFileSync(sourcePath, join(dir, name))
  const full = join(dir, name)
  const st = statSync(full)
  return {
    id: 'bg:' + name,
    name: basename(name, ext),
    kind,
    path: full,
    url: 'file:///' + full.replace(/\\/g, '/'),
    size: st.size,
    addedAt: Math.round(st.mtimeMs)
  }
}

export function deleteBackground(id: string): boolean {
  const name = id.startsWith('bg:') ? id.slice(3) : id
  const full = join(backgroundDir(), basename(name))
  if (!existsSync(full)) return false
  try {
    unlinkSync(full)
    return true
  } catch {
    return false
  }
}

export function externalBackground(path: string): BackgroundMedia | null {
  if (!existsSync(path)) return null
  const kind = mediaKindOf(path)
  if (!kind) return null
  let size = 0
  try {
    size = statSync(path).size
  } catch {
    /* ignore */
  }
  return {
    id: 'ext:' + path,
    name: basename(path, extname(path)),
    kind,
    path,
    url: 'file:///' + path.replace(/\\/g, '/'),
    size,
    addedAt: Date.now()
  }
}
