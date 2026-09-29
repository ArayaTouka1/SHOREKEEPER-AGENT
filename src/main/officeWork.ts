import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import { XMLParser, XMLBuilder } from 'fast-xml-parser'

const xmlOptions = { ignoreAttributes: false, preserveOrder: true, trimValues: false, parseTagValue: false }
const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function createDocx(text: string): Promise<Buffer> {
  if (!text.trim()) throw new Error('文档正文不能为空')
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  const paragraphs = text.split(/\r?\n/).map(line => '<w:p><w:r><w:t xml:space="preserve">' + escapeXml(line) + '</w:t></w:r></w:p>').join('')
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + paragraphs + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

export async function replaceDocx(input: Buffer, oldText: string, newText: string): Promise<{ bytes: Buffer; count: number }> {
  if (!oldText || /[\r\n]/.test(oldText + newText)) throw new Error('请提供单段落内的精确替换文本，不支持跨段落替换')
  const zip = await JSZip.loadAsync(input)
  const part = zip.file('word/document.xml')
  if (!part) throw new Error('文件不是有效的 DOCX')
  const tree = new XMLParser(xmlOptions).parse(await part.async('text'))
  let count = 0
  function visit(nodes: any[]): void {
    for (const node of nodes) for (const [tag, children] of Object.entries(node)) {
      if (!Array.isArray(children)) continue
      if (tag !== 'w:p') { visit(children); continue }
      const texts: any[] = []
      function collect(items: any[]): void {
        for (const item of items) for (const [key, value] of Object.entries(item)) {
          if (key === 'w:t' && Array.isArray(value)) { for (const t of value) if ('#text' in t) texts.push(t) }
          else if (Array.isArray(value)) collect(value)
        }
      }
      collect(children)
      const original = texts.map(t => String(t['#text'])).join('')
      const start = original.indexOf(oldText)
      if (start < 0) continue
      if (original.indexOf(oldText, start + oldText.length) >= 0 || count) throw new Error('匹配不唯一，请扩大被替换文本，避免误改')
      // Keep every run and its formatting; only distribute the changed character range.
      let offset = 0
      const end = start + oldText.length
      for (const t of texts) {
        const value = String(t['#text'])
        const next = offset + value.length
        if (next > start && offset < end) {
          t['#text'] = value.slice(0, Math.max(0, start - offset)) + (offset <= start ? newText : '') + value.slice(Math.max(0, end - offset))
        }
        offset = next
      }
      count++
    }
  }
  visit(tree)
  if (!count) throw new Error('正文中没有找到精确匹配，请先读取文档')
  zip.file('word/document.xml', new XMLBuilder(xmlOptions).build(tree))
  return { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), count }
}

export async function writeSheet(input: Buffer | undefined, sheetName: string, cellsJson: string): Promise<{ bytes: Buffer; count: number }> {
  const cells = JSON.parse(cellsJson) as unknown
  if (!Array.isArray(cells) || !cells.length || cells.length > 10000) throw new Error('cells 必须是包含 1 至 10000 项的 JSON 数组')
  const workbook = new ExcelJS.Workbook()
  if (input) await workbook.xlsx.load(input as any)
  const sheet = workbook.getWorksheet(sheetName) ?? workbook.addWorksheet(sheetName)
  for (const cell of cells) {
    if (!cell || typeof cell !== 'object' || !/^[A-Z]{1,3}[1-9]\d{0,6}$/i.test(cell.address ?? '')) throw new Error('单元格地址无效')
    const target = sheet.getCell(cell.address)
    if (Number(target.col) > 16384 || Number(target.row) > 1048576) throw new Error('单元格超出 Excel 范围')
    const value = cell.value
    if (cell.formula !== undefined) {
      if (typeof cell.formula !== 'string' || !cell.formula.trim()) throw new Error('formula 必须是非空字符串')
      target.value = { formula: cell.formula.replace(/^=/, '') }
    } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) target.value = value
    else throw new Error('单元格 value 仅支持文字、数字、布尔值或 null')
  }
  workbook.calcProperties.fullCalcOnLoad = true
  return { bytes: Buffer.from(await workbook.xlsx.writeBuffer()), count: cells.length }
}
