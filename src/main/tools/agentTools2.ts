/**
 *
 *   dsh-tool-web        → web_search / web_fetch
 *   dsh-tool-todo       → todo_write
 *   dsh-tool-goal       → goal_set / goal_get
 *   dsh-tool-ask-user   → ask_user
 *   dsh-tool-present    → present_files
 *   dsh-tool-skill      → skill_load
 *   dsh-tool-plan-mode  → plan_enter
 */

import { defineTool, type ToolDefinition, type ToolOutcome } from '../toolKit'
import type { TodoItem } from '../../shared/types'

export interface InteractionImpl {
  webSearch(query: string): Promise<ToolOutcome>
  webFetch(url: string): Promise<ToolOutcome>
  writeTodos(list: TodoItem[]): ToolOutcome
  getTodos(): TodoItem[]
  presentFiles(paths: string[], description: string): ToolOutcome
  displayNameOf(name: string): string | undefined
}

export function createWebTools(impl: InteractionImpl): ToolDefinition[] {
  return [
    defineTool({
      name: 'web_search',
      displayName: '联网搜索',
      actionLabel: '联网搜索',
      description: '用搜索引擎检索当前信息，返回摘要与来源链接。',
      category: 'web',
      permission: 'always',
      params: [{ key: 'query', label: '搜索词', required: true, example: '今天的天气' }],
      isConcurrencySafe: () => true,
      execute: (args) => impl.webSearch(String(args.query ?? ''))
    }),

    defineTool({
      name: 'web_fetch',
      displayName: '抓取网页',
      actionLabel: '抓取网页',
      description: '抓取指定 URL 的正文内容并转成纯文本。',
      category: 'web',
      permission: 'always',
      params: [{ key: 'url', label: '网址', required: true, example: 'https://example.com' }],
      isConcurrencySafe: () => true,
      execute: (args) => impl.webFetch(String(args.url ?? ''))
    })
  ]
}

export function createTaskTools(impl: InteractionImpl): ToolDefinition[] {
  const s = (args: Record<string, unknown>, k: string, d = ''): string => String(args[k] ?? d)

  return [
    defineTool({
      name: 'todo_write',
      displayName: '更新待办',
      actionLabel: '更新待办',
      description: '整体覆盖当前待办清单（每项含内容与状态）。',
      category: 'agent',
      permission: 'always',
      params: [{ key: 'todos', label: '待办列表', type: 'array', required: true }],
      execute: (args) => {
        const raw = args.todos
        const list = Array.isArray(raw) ? (raw as TodoItem[]) : []
        return impl.writeTodos(list)
      }
    }),

    defineTool({
      name: 'goal_set',
      displayName: '设定目标',
      actionLabel: '设定目标',
      description: '记录本轮要达成的目标与最多轮数，用于长任务持续推进。',
      category: 'agent',
      permission: 'always',
      params: [
        { key: 'objective', label: '目标', required: true },
        { key: 'maxRounds', label: '最多轮数', type: 'number', example: '20' }
      ],
      execute: (args) => {
        const objective = s(args, 'objective')
        const maxRounds = Number(args.maxRounds ?? 20)
        return {
          result: { objective, maxRounds },
          summary: `已设定目标：${objective.slice(0, 30)}`,
          context: `目标已记录：${objective}（最多 ${maxRounds} 轮）`
        }
      }
    }),

    defineTool({
      name: 'goal_get',
      displayName: '读取进度',
      actionLabel: '读取进度',
      description: '读取当前待办与目标进度。',
      category: 'agent',
      permission: 'always',
      params: [],
      isConcurrencySafe: () => true,
      execute: () => {
        const todos = impl.getTodos()
        return {
          result: { todos },
          summary: '已读取当前进度',
          context: `当前待办 ${todos.length} 项。`
        }
      }
    }),

    defineTool({
      name: 'plan_enter',
      displayName: '提交计划',
      actionLabel: '提交计划',
      description: '在执行前提交一份计划，等用户确认后再动手。',
      category: 'plan',
      permission: 'always',
      params: [{ key: 'plan', label: '计划内容', required: true }],
      execute: (args) => ({
        result: { plan: s(args, 'plan') },
        summary: '已提交计划待确认',
        context: '已提交计划，等待用户确认后执行。'
      })
    }),

    defineTool({
      name: 'ask_user',
      displayName: '向用户提问',
      actionLabel: '向用户提问',
      description: '当信息不足时向用户提问，可给出候选项。',
      category: 'interaction',
      permission: 'always',
      params: [
        { key: 'question', label: '问题', required: true },
        { key: 'options', label: '候选项', type: 'array' }
      ],
      execute: (args) => {
        const question = s(args, 'question')
        return {
          result: { question, options: args.options ?? [] },
          summary: `向用户提问：${question.slice(0, 30)}`,
          context: `已向用户提问：${question}`
        }
      }
    }),

    defineTool({
      name: 'present_files',
      displayName: '展示文件',
      actionLabel: '展示文件',
      description: '把生成的文件作为交付物展示给用户。',
      category: 'interaction',
      permission: 'always',
      params: [
        { key: 'paths', label: '文件路径', type: 'array', required: true },
        { key: 'description', label: '说明' }
      ],
      execute: (args) => {
        const paths = Array.isArray(args.paths) ? (args.paths as string[]) : [s(args, 'paths')]
        return impl.presentFiles(paths.filter(Boolean), s(args, 'description'))
      }
    }),


    ...(['subagent_run', 'workflow_run', 'ralph_run'] as const).map((name) =>
      defineTool({
        name,
        displayName: impl.displayNameOf(name) ?? name,
        actionLabel: '派发任务',
        description:
          name === 'subagent_run'
            ? '派发一个子任务给独立上下文执行，返回其结论。'
            : name === 'workflow_run'
              ? '运行一段编排脚本，批量派发多个子任务。'
              : '反复迭代直到目标达成（Ralph 循环）。',
        category: 'agent',
        permission: 'once',
        params: [
          { key: 'prompt', label: '任务描述' },
          { key: 'script', label: '编排脚本' },
          { key: 'objective', label: '目标' }
        ],
        execute: (args) => {
          const prompt = s(args, 'prompt') || s(args, 'script') || s(args, 'objective')
          return {
            result: { accepted: true, kind: name, prompt },
            summary: `${impl.displayNameOf(name) ?? name} 已受理`,
            context: `已受理 ${name} 请求。该能力在桌面版里以「单轮内联执行」方式落地，结果会直接回灌到本轮回复。`
          }
        }
      })
    ),

    defineTool({
      name: 'skill_load',
      displayName: '加载技能',
      actionLabel: '加载技能',
      description: '加载一份技能说明（SKILL.md），按其中的流程执行任务。',
      category: 'agent',
      permission: 'always',
      params: [{ key: 'name', label: '技能名', required: true }],
      execute: (args) => {
        const name = s(args, 'name')
        return {
          result: { name },
          summary: `已加载技能 ${name}`,
          context: `已加载技能「${name}」。`
        }
      }
    })
  ]
}

export interface VisionImpl {
  imageDescribe(path: string, prompt?: string): Promise<ToolOutcome>
}

export function createVisionTools(impl: VisionImpl): ToolDefinition[] {
  return [
    defineTool({
      name: 'image_understand',
      displayName: '识别图片',
      actionLabel: '识别图片',
      description: '识别一张本地图片的内容，返回画面描述（主体、人物、场景、文字等）。用户发来图片但你不确定内容时调用。',
      category: 'interaction',
      permission: 'always',
      params: [
        { key: 'path', label: '图片路径', required: true, example: 'C:\\Users\\me\\Pictures\\cat.png' },
        { key: 'question', label: '想重点看什么（可选）', example: '这张图里的人在做什么' }
      ],
      isConcurrencySafe: () => true,
      execute: (args) => impl.imageDescribe(String(args.path ?? ''), args.question ? String(args.question) : undefined)
    })
  ]
}
