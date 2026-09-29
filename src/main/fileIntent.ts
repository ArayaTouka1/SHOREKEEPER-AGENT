export interface FileIntent { tool: string; params: Record<string, unknown> }

/** Offline commands only accept an explicit path; file content is never guessed. */
export function detectFileIntent(text: string): FileIntent | null {
  const value = text.trim()
  const verbs: Array<[RegExp, string]> = [
    [/^(?:请|帮我|请帮我)?\s*(?:列目录|列出目录|列出文件|查看目录|读取目录)\s*[:：]?\s*([\s\S]*)$/, 'fs_list'],
    [/^(?:请|帮我|请帮我)?\s*(?:读取文件|读文件|打开文件|看看文件|读一下|读取)\s*[:：]?\s*([\s\S]+)$/, 'fs_read'],
    [/^(?:请|帮我|请帮我)?\s*(?:文件信息|文件大小)\s*[:：]?\s*([\s\S]+)$/, 'fs_stat']
  ]
  for (const [pattern, tool] of verbs) {
    const match = value.match(pattern)
    if (match) return { tool, params: { path: match[1].trim().replace(/^["“'](.*)["”']$/, '$1') || '.' } }
  }
  const write = value.match(/^(?:请|帮我|请帮我)?\s*(?:创建文件|新建文件|写文件|写入文件|追加文件)\s*[:：]?\s*(.+?)(?:\r?\n|\s+内容\s*[:：])([\s\S]*)$/)
  if (write) return { tool: value.includes('追加文件') ? 'fs_append' : 'fs_write', params: { path: write[1].trim().replace(/^["“'](.*)["”']$/, '$1'), content: write[2] } }
  const find = value.match(/^(?:查找文件|搜索文件)\s*[:：]?\s*(.+?)(?:\s+目录\s*[:：]\s*(.+))?$/)
  if (find) return { tool: 'fs_glob', params: { pattern: find[1].trim(), path: find[2]?.trim() || '.' } }
  return null
}
