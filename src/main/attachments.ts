/**
 */

import { app } from 'electron'
import { createHash } from 'node:crypto'
import { toAppFileUrl, allowFile } from './localFile'
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync, unlinkSync, readdirSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import type { Attachment } from '../shared/types'

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']
const TEXT_EXT = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.jsx', '.css', '.html', '.yml', '.yaml', '.ini', '.log', '.csv', '.xml', '.py', '.sh', '.ps1', '.c', '.cpp', '.h', '.java', '.go', '.rs', '.sql', '.toml']
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac']
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.mkv', '.m4v']

export function attachmentDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function kindOf(file: string): Attachment['kind'] {
  const ext = extname(file).toLowerCase()
  if (IMAGE_EXT.includes(ext)) return 'image'
  if (TEXT_EXT.includes(ext)) return 'text'
  if (ext === '.pdf') return 'pdf'
  if (AUDIO_EXT.includes(ext)) return 'audio'
  if (VIDEO_EXT.includes(ext)) return 'video'
  return 'other'
}

function previewOf(full: string, kind: Attachment['kind']): string | undefined {
  if (kind !== 'text') return undefined
  try {
    const st = statSync(full)
    if (st.size > 2 * 1024 * 1024) {
      return readFileSync(full, 'utf-8').slice(0, 8000) + '\n…（文件较大，仅取开头）'
    }
    return readFileSync(full, 'utf-8').slice(0, 8000)
  } catch {
    return undefined
  }
}

function toAttachment(full: string): Attachment {
  const kind = kindOf(full)
  let size = 0
  try {
    size = statSync(full).size
  } catch {
    /* ignore */
  }
  return {
    id: 'att_' + createHash('sha256').update(process.platform === 'win32' ? full.toLowerCase() : full).digest('hex').slice(0, 24),
    name: basename(full),
    path: full,
    url: toAppFileUrl(full),
    kind,
    size,
    preview: previewOf(full, kind),
    addedAt: statSync(full).mtimeMs
  }
}

export function importAttachment(sourcePath: string): Attachment {
  if (!existsSync(sourcePath)) throw new Error('文件不存在：' + sourcePath)
  const dir = attachmentDir()
  const ext = extname(sourcePath)
  const safe = basename(sourcePath, ext).replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || 'file'
  let name = `${safe}${ext}`
  let n = 1
  while (existsSync(join(dir, name))) name = `${safe}_${n++}${ext}`
  const dest = join(dir, name)
  copyFileSync(sourcePath, dest)
  allowFile(dest)
  return toAttachment(dest)
}

export function externalAttachment(sourcePath: string): Attachment | null {
  if (!existsSync(sourcePath)) return null
  allowFile(sourcePath)
  return toAttachment(sourcePath)
}

export function listAttachments(): Attachment[] {
  const dir = attachmentDir()
  const out: Attachment[] = []
  try {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f)
      try {
        if (statSync(full).isFile()) out.push(toAttachment(full))
      } catch {
        /* skip */
      }
    }
  } catch {
  }
  return out.sort((a, b) => b.addedAt - a.addedAt)
}

export function deleteAttachment(idOrName: string): boolean {
  const dir = attachmentDir()
  const name = idOrName.startsWith('att_') ? listAttachments().find(a => a.id === idOrName)?.name : basename(idOrName)
  if (!name) return false
  const full = join(dir, name)
  if (!existsSync(full)) return false
  try {
    unlinkSync(full)
    return true
  } catch {
    return false
  }
}
