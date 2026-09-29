const fs = require('node:fs')
const path = require('node:path')
const JSZip = require('jszip')
const ExcelJS = require('exceljs')
const { PDFDocument, StandardFonts } = require('pdf-lib')
const PptxGenJS = require('pptxgenjs')

module.exports = async function fixtures(root) {
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, '说明 文档.md'), '# Workspace Preview\n\n中文路径与文件内容。\n\n| Format | Status |\n| --- | --- |\n| PDF | Ready |\n')
  fs.writeFileSync(path.join(root, 'data.csv'), 'name,note\r\n"张三","hello, world"\r\nAlice,"two\nlines"\r\n')
  fs.writeFileSync(path.join(root, 'utf16.txt'), Buffer.concat([Buffer.from([255, 254]), Buffer.from('UTF16 中文内容', 'utf16le')]))
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('明细').addRows([['产品', '数量'], ['测试', 12]])
  workbook.addWorksheet('Summary').addRows([['Total', 12]])
  await workbook.xlsx.writeFile(path.join(root, 'workbook.xlsx'))
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= 2; i++) pdf.addPage([600, 400]).drawText(`Workspace PDF page ${i}`, { x: 60, y: 300, size: 24, font })
  fs.writeFileSync(path.join(root, 'sample.pdf'), await pdf.save())
  const ppt = new PptxGenJS()
  for (let i = 1; i <= 2; i++) {
    const slide = ppt.addSlide()
    slide.background = { color: i === 1 ? 'E4F2F0' : 'EAF0FC' }
    slide.addText(`Workspace Slide ${i}`, { x: .6, y: .6, w: 8, h: 1, fontSize: 28, color: '14332F' })
    slide.addText('Local preview is working.', { x: .6, y: 2, w: 8, h: 1, fontSize: 20 })
  }
  await ppt.writeFile({ fileName: path.join(root, 'slides.pptx') })
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Workspace DOCX Preview</w:t></w:r></w:p><w:p><w:r><w:t>中文 Word 正文 &amp; table test</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>')
  fs.writeFileSync(path.join(root, 'sample.docx'), await zip.generateAsync({ type: 'nodebuffer' }))
}
