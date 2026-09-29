/**
 *
 *
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { inflateRawSync } from 'node:zlib'

export const MAX_EXTRACT_CHARS = 24000

export interface ExtractResult {
  text: string
  method: string
  truncated: boolean
  error?: string
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

function clamp(s: string, max = MAX_EXTRACT_CHARS): { text: string; truncated: boolean } {
  const t = s.replace(/\u0000/g, '').trim()
  if (t.length <= max) return { text: t, truncated: false }
  return { text: t.slice(0, max) + `\n\n…（内容过长，已截断，共 ${t.length} 字）`, truncated: true }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

interface ZipEntry {
  name: string
  data: Buffer
}

/**
 */
function readZip(buf: Buffer): ZipEntry[] {
  const out: ZipEntry[] = []

  let eocd = -1
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP（找不到 EOCD）')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length) break
    if (buf.readUInt32LE(p) !== 0x02014b50) break

    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen)

    if (localOffset + 30 <= buf.length && buf.readUInt32LE(localOffset) === 0x04034b50) {
      const lNameLen = buf.readUInt16LE(localOffset + 26)
      const lExtraLen = buf.readUInt16LE(localOffset + 28)
      const dataStart = localOffset + 30 + lNameLen + lExtraLen
      const raw = buf.subarray(dataStart, dataStart + compSize)
      try {
        const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
        out.push({ name, data })
      } catch {
      }
    }

    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

/* ------------------------------------------------------------------ *
 *  DOCX
 * ------------------------------------------------------------------ */

function extractDocx(buf: Buffer): ExtractResult {
  const zip = readZip(buf)
  const doc = zip.find((e) => e.name === 'word/document.xml')
  if (!doc) return { text: '', method: 'docx', truncated: false, error: 'docx 里没有 word/document.xml' }

  const xml = doc.data.toString('utf-8')
  const paras = xml.split(/<\/w:p>/)
  const lines: string[] = []
  for (const para of paras) {
    const runs = [...para.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1])
    const line = runs
      .join('')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
    if (line.trim()) lines.push(line)
  }

  const c = clamp(lines.join('\n'))
  return { text: c.text, method: 'docx（解析 word/document.xml）', truncated: c.truncated }
}

/* ------------------------------------------------------------------ *
 *  XLSX
 * ------------------------------------------------------------------ */

function extractXlsx(buf: Buffer): ExtractResult {
  const zip = readZip(buf)

  const ss = zip.find((e) => e.name === 'xl/sharedStrings.xml')
  const shared: string[] = []
  if (ss) {
    const xml = ss.data.toString('utf-8')
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const texts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1])
      shared.push(
        texts
          .join('')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
      )
    }
  }

  const lines: string[] = []
  const sheets = zip.filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))

  for (const sheet of sheets.slice(0, 5)) {
    lines.push(`### ${basename(sheet.name)}`)
    const xml = sheet.data.toString('utf-8')
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = []
      for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? ''
        const body = c[2] ?? ''
        const isShared = /t="s"/.test(attrs)
        const isInline = /t="(inlineStr|str)"/.test(attrs)
        const inline = body.match(/<t[^>]*>([\s\S]*?)<\/t>/)
        const v = body.match(/<v>([\s\S]*?)<\/v>/)

        if (inline && isInline) {
          cells.push(inline[1])
        } else if (v) {
          cells.push(isShared ? (shared[Number(v[1])] ?? '') : v[1])
        } else if (inline) {
          cells.push(inline[1])
        }
      }
      const line = cells.join('\t').trim()
      if (line) lines.push(line)
    }
    lines.push('')
  }

  if (!lines.length) return { text: '', method: 'xlsx', truncated: false, error: 'xlsx 里没有可读的工作表' }
  const c = clamp(lines.join('\n'))
  return { text: c.text, method: 'xlsx（解析工作表）', truncated: c.truncated }
}

/* ------------------------------------------------------------------ *
 *  PDF
 * ------------------------------------------------------------------ */

/**
 *
 */
function extractPdf(buf: Buffer): ExtractResult {
  const raw = buf.toString('latin1')
  const chunks: string[] = []

  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let m: RegExpExecArray | null
  let streams = 0

  while ((m = streamRe.exec(raw)) !== null) {
    streams++
    if (streams > 400) break
    const body = Buffer.from(m[1], 'latin1')
    let content = ''
    try {
      content = inflateRawSync(body).toString('latin1')
    } catch {
      content = body.toString('latin1')
    }
    if (!/(Tj|TJ|BT)/.test(content)) continue

    for (const t of content.matchAll(/\(((?:\\.|[^\\()])*)\)/g)) {
      const s = t[1]
        .replace(/\\([()\\])/g, '$1')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
      if (s.trim()) chunks.push(s)
    }
    if (chunks.length > 20000) break
  }

  if (!chunks.length) {
    return {
      text: '',
      method: 'pdf',
      truncated: false,
      error: '这个 PDF 没有可抽取的文本层（可能是扫描件/纯图片），需要 OCR 才能读'
    }
  }

  const text = chunks
    .join(' ')
    .replace(/\s{3,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
  const c = clamp(text)
  return { text: c.text, method: 'pdf（抽取文本层）', truncated: c.truncated }
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

export function extractAttachmentText(fullPath: string, kind: string): ExtractResult {
  if (!existsSync(fullPath)) {
    return { text: '', method: 'none', truncated: false, error: '文件不存在' }
  }

  const ext = extname(fullPath).toLowerCase()
  let size = 0
  try {
    size = statSync(fullPath).size
  } catch {
    /* ignore */
  }

  try {
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg'].includes(ext)) {
      return {
        text: `（这是图片文件 ${basename(fullPath)}，${(size / 1024).toFixed(0)}KB。当前模型没有视觉能力，无法读取图片像素内容。）`,
        method: 'image',
        truncated: false
      }
    }

    if (size > 40 * 1024 * 1024) {
      return {
        text: '',
        method: 'skip',
        truncated: false,
        error: `文件太大（${(size / 1024 / 1024).toFixed(1)}MB），已跳过`
      }
    }

    const buf = readFileSync(fullPath)

    if (ext === '.pdf') return extractPdf(buf)
    if (ext === '.docx') return extractDocx(buf)
    if (ext === '.xlsx') return extractXlsx(buf)
    if (ext === '.doc' || ext === '.xls' || ext === '.ppt') {
      return {
        text: '',
        method: 'legacy-office',
        truncated: false,
        error: '这是老版 Office 格式（.doc/.xls/.ppt），请另存为 .docx/.xlsx 后再上传'
      }
    }

    const text = buf.toString('utf-8')
    const nul = (text.match(/\u0000/g) || []).length
    if (nul > text.length * 0.01) {
      return { text: '', method: 'binary', truncated: false, error: '这看起来是二进制文件，无法作为文本读取' }
    }

    const c = clamp(text)
    return { text: c.text, method: 'text（直接读取）', truncated: c.truncated }
  } catch (e) {
    return {
      text: '',
      method: 'error',
      truncated: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}
