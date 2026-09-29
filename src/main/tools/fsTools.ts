/**
 *
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { defineTool, type ToolDefinition, type ToolOutcome } from '../toolKit'

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

import { extname } from 'node:path'
import { statSync } from 'node:fs'
import { resolveSafePath, displayPath, getWorkspaceRoot } from '../safeFs'
import { documentVersion } from '../documents'
import { createDocx, replaceDocx, writeSheet } from '../officeWork'
import { ensureParentDir, atomicWrite } from '../safeFs'
import { securityState } from '../workspaceSecurity'
import { getMachinePermission } from '../permission'

/**
 */
export type ToolOutcomeLike = ToolOutcome | Promise<ToolOutcome>

export interface FsImpl {
  readTextFile(path: string, offset: number, limit: number): ToolOutcomeLike
  writeTextFile(path: string, content: string, mode: 'a' | 'w', expectedVersion?: string): ToolOutcomeLike
  editFile(path: string, oldText: string, newText: string, replaceAll: boolean): ToolOutcomeLike
  listDir(path: string): ToolOutcomeLike
  searchFiles(pattern: string, path: string, maxHits: number, maxDepth: number): ToolOutcomeLike
  globFiles(pattern: string, path: string): ToolOutcomeLike
  deleteFile(path: string): ToolOutcomeLike
  moveFile(src: string, dst: string): ToolOutcomeLike
  copyFile(src: string, dst: string): ToolOutcomeLike
  statPath(path: string): ToolOutcomeLike
}

/**
 */
export function createFsTools(impl: FsImpl): ToolDefinition[] {
  const s = (args: Record<string, unknown>, k: string, d = ''): string => String(args[k] ?? d)

  return [
    defineTool({
      name: 'fs_read',
      displayName: '读取文件',
      actionLabel: '读取文件',
      description: '读取任意路径的文本文件内容（只读，无需授权），支持指定起始行与行数。',
      category: 'fs',
      permission: 'always',
      params: [
        { key: 'path', label: '文件路径', required: true, example: 'notes/todo.md' },
        { key: 'offset', label: '起始行', type: 'number', example: '1' },
        { key: 'limit', label: '行数', type: 'number', example: '200' }
      ],
      isConcurrencySafe: () => true,
      execute: (args) =>
        impl.readTextFile(s(args, 'path'), Number(args.offset ?? 1) || 1, Number(args.limit ?? 400) || 400)
    }),

    defineTool({
      name: 'fs_write',
      displayName: '写入文件',
      actionLabel: '写入文件',
      description: '创建或整体覆盖一个文本文件。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'path', label: '文件路径', required: true, example: 'notes/new.md' },
        { key: 'content', label: '内容', required: true, allowEmpty: true }
      ],
      execute: (args) => {
        if (!Object.prototype.hasOwnProperty.call(args, 'content')) {
          throw new Error('写入文件必须提供 content 内容')
        }
        if (args.createOnly === true && existsSync(resolveSafePath(s(args, 'path'), { forWrite: true }))) {
          throw new Error('同名文件已存在，请直接打开编辑')
        }
        return impl.writeTextFile(
          s(args, 'path'),
          s(args, 'content'),
          args.mode === 'a' ? 'a' : 'w',
          s(args, 'expectedVersion') || undefined
        )
      }
    }),

    defineTool({
      name: 'fs_append',
      displayName: '追加内容',
      actionLabel: '追加内容',
      description: '在文件末尾追加内容（不存在时创建）。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'path', label: '文件路径', required: true },
        { key: 'content', label: '内容', required: true }
      ],
      execute: (args) => impl.writeTextFile(s(args, 'path'), s(args, 'content'), 'a')
    }),

    defineTool({
      name: 'fs_edit',
      displayName: '编辑文件',
      actionLabel: '编辑文件',
      description: '在文件里把指定文本替换成新文本（精确匹配）。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'path', label: '文件路径', required: true },
        { key: 'oldText', label: '被替换文本', required: true },
        { key: 'newText', label: '新文本', required: true },
        { key: 'replaceAll', label: '替换全部', type: 'boolean' }
      ],
      execute: (args) =>
        impl.editFile(
          s(args, 'path'),
          s(args, 'oldText'),
          s(args, 'newText'),
          args.replaceAll === true || args.replaceAll === 'true'
        )
    }),

    defineTool({
      name: 'fs_list',
      displayName: '列出目录',
      actionLabel: '列出目录',
      description: '列出某个目录的文件与子目录（只读）。',
      category: 'fs',
      permission: 'always',
      params: [{ key: 'path', label: '目录', example: '.' }],
      isConcurrencySafe: () => true,
      execute: (args) => impl.listDir(s(args, 'path', '.'))
    }),

    defineTool({
      name: 'fs_search',
      displayName: '搜索文件内容',
      actionLabel: '搜索内容',
      description: '按正则搜索文本，返回匹配行（只读）。',
      category: 'fs',
      permission: 'always',
      params: [
        { key: 'pattern', label: '正则', required: true },
        { key: 'path', label: '目录', example: '.' },
        { key: 'maxHits', label: '最多命中', type: 'number', example: '60' },
        { key: 'maxDepth', label: '最大深度', type: 'number', example: '6' }
      ],
      isConcurrencySafe: () => true,
      execute: (args) =>
        impl.searchFiles(
          s(args, 'pattern'),
          s(args, 'path', '.'),
          Number(args.maxHits ?? 60) || 60,
          Number(args.maxDepth ?? 6) || 6
        )
    }),

    defineTool({
      name: 'fs_glob',
      displayName: '按模式找文件',
      actionLabel: '查找文件',
      description: '按通配模式（glob）列出匹配的文件路径（只读）。',
      category: 'fs',
      permission: 'always',
      params: [
        { key: 'pattern', label: '模式', required: true, example: '**/*.md' },
        { key: 'path', label: '起点目录', example: '.' }
      ],
      isConcurrencySafe: () => true,
      execute: (args) => impl.globFiles(s(args, 'pattern'), s(args, 'path', '.'))
    }),

    defineTool({
      name: 'fs_delete',
      displayName: '删除文件',
      actionLabel: '删除文件',
      description: '删除一个文件（目录请用 shell_run）。',
      category: 'fs',
      permission: 'once',
      params: [{ key: 'path', label: '文件路径', required: true }],
      execute: (args) => impl.deleteFile(s(args, 'path'))
    }),

    defineTool({
      name: 'fs_move',
      displayName: '移动/重命名',
      actionLabel: '移动文件',
      description: '移动或重命名文件（跨盘自动退化为复制+删除）。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'src', label: '源路径', required: true },
        { key: 'dst', label: '目标路径', required: true }
      ],
      execute: (args) => impl.moveFile(s(args, 'src') || s(args, 'from'), s(args, 'dst') || s(args, 'to'))
    }),

    defineTool({
      name: 'fs_copy',
      displayName: '复制文件',
      actionLabel: '复制文件',
      description: '复制一个文件到新位置。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'src', label: '源路径', required: true },
        { key: 'dst', label: '目标路径', required: true }
      ],
      execute: (args) => impl.copyFile(s(args, 'src') || s(args, 'from'), s(args, 'dst') || s(args, 'to'))
    }),

    defineTool({
      name: 'fs_stat',
      displayName: '查看文件信息',
      actionLabel: '查看信息',
      description: '查看文件或目录的大小、时间、类型（只读）。',
      category: 'fs',
      permission: 'always',
      params: [{ key: 'path', label: '路径', required: true }],
      isConcurrencySafe: () => true,
      execute: (args) => impl.statPath(s(args, 'path'))
    }),


    defineTool({
      name: 'fs_roots',
      displayName: '列出磁盘与常用目录',
      actionLabel: '列出磁盘',
      description: '列出所有磁盘分区与常用目录（桌面/文档/下载/主目录），用来定位用户文件位置。',
      category: 'fs',
      permission: 'always',
      params: [],
      isConcurrencySafe: () => true,
      execute: () => {
        const roots = ['desktop', 'documents', 'downloads', 'home'].map((key) => ({
          name: key,
          path: app.getPath(key as 'home')
        }))
        if (process.platform === 'win32') {
          for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            const path = `${letter}:\\`
            if (existsSync(path)) roots.push({ name: letter, path })
          }
        } else {
          roots.push({ name: '/', path: '/' })
        }
        return {
          result: { workspace: process.cwd(), roots },
          summary: '已读取磁盘和常用目录',
          context: JSON.stringify({ roots })
        }
      }
    }),


    ...createOfficeTools()
  ]
}

/* ------------------------------------------------------------------ *
 * ------------------------------------------------------------------ */

async function saveOffice(
  name: string,
  args: Record<string, unknown>,
  build: (original: Buffer | undefined) => Promise<{ bytes: Buffer; count: number }>
): Promise<ToolOutcome> {
  const workspace = getWorkspaceRoot()
  const tier = getMachinePermission()
  const path = resolveSafePath(String(args.path ?? ''), { forWrite: true })
  const ext = name === 'fs_sheet_write' ? '.xlsx' : '.docx'
  if (extname(path).toLowerCase() !== ext) throw new Error('文件扩展名必须是 ' + ext)

  const present = existsSync(path)
  if (name === 'fs_docx_create' && present) throw new Error('同名文档已存在，请修改现有文档或选择新名称')
  if (name === 'fs_docx_replace' && !present) throw new Error('文档不存在')
  if (present && statSync(path).size > 32 * 1024 * 1024) throw new Error('文档超过 32 MB 限制')

  const original = present ? readFileSync(path) : undefined
  const version = original ? documentVersion(original) : undefined

  const result = await build(original)

  if (workspace !== getWorkspaceRoot() || tier !== getMachinePermission() || (tier !== 'full' && !securityState(workspace).trusted)) throw new Error('操作期间权限已变更')
  if (
    resolveSafePath(String(args.path ?? ''), { forWrite: true }) !== path ||
    (existsSync(path) ? documentVersion(readFileSync(path)) : undefined) !== version
  ) {
    throw new Error('文件已被外部修改，请重新读取后重试')
  }

  ensureParentDir(path)
  const backup = original ? path + '.backup-' + Date.now() : undefined
  if (backup) {
    resolveSafePath(backup, { forWrite: true })
    writeFileSync(backup, original!, { flag: 'wx' })
  }
  atomicWrite(path, result.bytes)

  return {
    result: {
      path,
      backup,
      bytes: result.bytes.length,
      changed: result.count,
      version: documentVersion(result.bytes)
    },
    summary: '已保存：' + displayPath(path),
    context:
      '已真实保存文件：' + displayPath(path) + '，修改项数：' + result.count +
      (backup ? '\n修改前备份：' + displayPath(backup) : ''),
    presentation: { kind: 'files', paths: [path] }
  }
}

function createOfficeTools(): ToolDefinition[] {
  return [
    defineTool({
      name: 'fs_docx_create',
      displayName: '创建 Word 文档',
      actionLabel: '创建文档',
      description: '创建一个 .docx 文档，写入给定的文本内容。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'path', label: '文档路径', required: true, example: 'report.docx' },
        { key: 'text', label: '正文', required: true }
      ],
      execute: (args) => saveOffice('fs_docx_create', args, async () => ({ bytes: await createDocx(String(args.text ?? '')), count: 1 }))
    }),

    defineTool({
      name: 'fs_docx_replace',
      displayName: '替换 Word 文档内容',
      actionLabel: '替换文档内容',
      description: '在已有 .docx 里把指定文本替换为新文本。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'path', label: '文档路径', required: true },
        { key: 'oldText', label: '被替换文本', required: true },
        { key: 'newText', label: '新文本', required: true }
      ],
      execute: (args) =>
        saveOffice('fs_docx_replace', args, (original) =>
          replaceDocx(original!, String(args.oldText ?? ''), String(args.newText ?? ''))
        )
    }),

    defineTool({
      name: 'fs_sheet_write',
      displayName: '写 Excel 表格',
      actionLabel: '写入表格',
      description: '创建或更新 .xlsx 表格，按 TSV 写入单元格。',
      category: 'fs',
      permission: 'once',
      params: [
        { key: 'path', label: '表格路径', required: true, example: 'data.xlsx' },
        { key: 'cells', label: '单元格内容（TSV）', required: true },
        { key: 'sheet', label: '工作表名', example: 'Sheet1' }
      ],
      execute: (args) =>
        saveOffice('fs_sheet_write', args, (original) =>
          writeSheet(original, String(args.sheet ?? 'Sheet1'), String(args.cells ?? ''))
        )
    })
  ]
}
