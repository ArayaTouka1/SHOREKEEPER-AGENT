import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import JSZip from 'jszip'
import { XMLParser } from 'fast-xml-parser'
import { resolveSafePath } from './safeFs'
import type { DocumentData } from '../shared/workspace'

const MAX_BYTES = 32 * 1024 * 1024
export const documentVersion = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

export function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  if (bytes.subarray(0, 8192).includes(0)) throw new Error('该文件是二进制内容，不能作为文本编辑')
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { return new TextDecoder('gb18030').decode(bytes) }
}

export function readDocumentBytes(path: string): { path: string; bytes: Buffer } {
  const full = resolveSafePath(path, { mustExist: true, readOnly: true })
  const stat = statSync(full)
  if (!stat.isFile()) throw new Error('请选择文件，而不是目录')
  if (stat.size > MAX_BYTES) throw new Error('文档超过 32 MB，请使用外部应用打开')
  return { path: full, bytes: readFileSync(full) }
}

export async function sheetData(bytes: Buffer, ext: string): Promise<NonNullable<DocumentData['sheets']>> {
  if (ext === '.csv' || ext === '.tsv') {
    const result = Papa.parse<string[]>(decodeText(bytes), { delimiter: ext === '.tsv' ? '\t' : '', skipEmptyLines: true })
    if (result.errors.some(e => e.type === 'Quotes')) throw new Error('CSV 引号未闭合，无法解析')
    return [{ name: '数据', rows: result.data.slice(0, 2000).map(r => r.slice(0, 100)), truncated: result.data.length > 2000 || result.data.some(r => r.length > 100) }]
  }
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as any)
  return workbook.worksheets.map(sheet => {
    const rows: string[][] = []
    const cols = Math.min(sheet.columnCount, 100)
    for (let i = 1; i <= Math.min(sheet.rowCount, 2000); i++) {
      rows.push(Array.from({ length: cols }, (_, col) => sheet.getRow(i).getCell(col + 1).text))
    }
    return { name: sheet.name, rows, truncated: sheet.rowCount > 2000 || sheet.columnCount > 100 }
  })
}

export async function openDocument(path: string): Promise<DocumentData> {
  const { path: full, bytes } = readDocumentBytes(path)
  const ext = extname(full).toLowerCase()
  const base = { path: full, name: basename(full), ext, size: bytes.length, version: documentVersion(bytes) }
  if (ext === '.pdf') return { ...base, kind: 'pdf', bytes }
  if (ext === '.docx') return { ...base, kind: 'docx', bytes }
  if (ext === '.pptx') return { ...base, kind: 'slides', bytes }
  if (['.xlsx', '.csv', '.tsv'].includes(ext)) return { ...base, kind: 'sheet', sheets: await sheetData(bytes, ext), text: ext !== '.xlsx' ? decodeText(bytes) : undefined }
  if (['.doc', '.ppt', '.xls'].includes(ext)) return { ...base, kind: 'unsupported' }
  try {
    const text = decodeText(bytes)
    return { ...base, kind: ['.md', '.markdown'].includes(ext) ? 'markdown' : 'text', text }
  } catch { return { ...base, kind: 'unsupported' } }
}

function xmlText(xml: string, tag: string): string {
  const parsed = new XMLParser({ ignoreAttributes: true, preserveOrder: true, processEntities: true }).parse(xml)
  const lines: string[] = []
  function walk(value: any): void {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (key === tag) lines.push((child as any[]).map(v => v['#text'] ?? '').join(''))
      else walk(child)
      if (key === 'w:p' || key === 'a:p') lines.push('\n')
    }
  }
  walk(parsed)
  return lines.join('')
}

export async function documentText(path: string): Promise<string> {
  const { bytes, path: full } = readDocumentBytes(path)
  const ext = extname(full).toLowerCase()
  if (['.xlsx', '.csv', '.tsv'].includes(ext)) {
    const sheets = await sheetData(bytes, ext)
    return sheets.map(s => `## ${s.name}\n${s.rows.map(r => r.join('\t')).join('\n')}${s.truncated ? '\n[工作表已截断]' : ''}`).join('\n\n')
  }
  if (ext === '.pdf') {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false })
    const pdf = await task.promise
    try {
      const pages: string[] = []
      for (let i = 1; i <= Math.min(pdf.numPages, 100); i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        pages.push(`[第 ${i} 页]\n` + content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''))
      }
      if (!pages.some(p => p.replace(/\[第 \d+ 页\]/, '').trim())) throw new Error('PDF 没有文本层，需要 OCR 识别')
      return pages.join('\n\n') + (pdf.numPages > 100 ? '\n[仅提取前 100 页]' : '')
    } finally { await pdf.destroy() }
  }
  if (ext === '.docx' || ext === '.pptx') {
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).filter(n => ext === '.docx' ? n === 'word/document.xml' : /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    if (!names.length) throw new Error('文档中没有正文')
    const texts: string[] = []
    for (const [i, name] of names.entries()) {
      const xml = await zip.file(name)!.async('string')
      texts.push((ext === '.pptx' ? `[幻灯片 ${i + 1}]\n` : '') + xmlText(xml, ext === '.docx' ? 'w:t' : 'a:t'))
    }
    return texts.join('\n\n')
  }
  return decodeText(bytes)
}
