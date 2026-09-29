/**
 */

import { defineTool, type ToolDefinition } from '../toolKit'
import { listJobs, startJob, jobOutput, killJob } from '../jobsStore'

/**
 */
export function createShellTools(runShell: (command: string, timeoutMs: number) => Promise<unknown>): ToolDefinition[] {
  const s = (args: Record<string, unknown>, k: string, d = ''): string => String(args[k] ?? d)

  return [
    defineTool({
      name: 'shell_run',
      displayName: '执行命令',
      actionLabel: '执行命令',
      description: '执行一条 shell / PowerShell 命令并返回输出。',
      category: 'shell',
      permission: 'once',
      params: [
        { key: 'command', label: '命令', required: true, example: 'dir' },
        { key: 'timeoutMs', label: '超时毫秒', type: 'number', example: '60000' }
      ],
      execute: (args) =>
        runShell(s(args, 'command'), Number(args.timeoutMs ?? 60000) || 60000) as never
    }),

    defineTool({
      name: 'shell_job',
      displayName: '启动后台任务',
      actionLabel: '启动后台任务',
      description: '在后台启动一条长时间运行的命令，返回任务 id，可用 job_output 查看输出。',
      category: 'shell',
      permission: 'once',
      params: [
        { key: 'command', label: '命令', required: true },
        { key: 'label', label: '任务名', example: 'npm run dev' }
      ],
      execute: (args) => {
        const info = startJob(s(args, 'command'), s(args, 'label'))
        return {
          result: info,
          summary: `后台任务已启动：${info.id}`,
          context: `后台任务已启动，id=${info.id}，名称「${info.label}」。可以用 job_output 查看输出。`,
          presentation: { kind: 'terminal' as const, command: s(args, 'command'), exitCode: 0 }
        }
      }
    }),


    defineTool({
      name: 'job_list',
      displayName: '列出后台任务',
      actionLabel: '列出任务',
      description: '列出当前所有后台任务及其状态。',
      category: 'system',
      permission: 'always',
      params: [],
      isConcurrencySafe: () => true,
      execute: () => {
        const jobs = listJobs()
        return {
          result: { jobs },
          summary: `当前有 ${jobs.length} 个后台任务`,
          context: `后台任务：\n${jobs.map((j) => `${j.id} [${j.status}] ${j.label}`).join('\n') || '（无）'}`
        }
      }
    }),

    defineTool({
      name: 'job_output',
      displayName: '查看任务输出',
      actionLabel: '查看输出',
      description: '查看某个后台任务的最新输出。',
      category: 'system',
      permission: 'always',
      params: [{ key: 'jobId', label: '任务 id', required: true }],
      isConcurrencySafe: () => true,
      execute: (args) => {
        const id = s(args, 'jobId')
        const r = jobOutput(id)
        if (!r) throw new Error(`找不到任务：${id}`)
        return {
          result: r,
          summary: `任务 ${id} 状态：${r.info.status}`,
          context: `任务 ${id}（${r.info.label}）状态 ${r.info.status}，输出：\n${r.output.slice(-4000)}`,
          presentation: { kind: 'terminal' as const, command: r.info.command, exitCode: r.info.exitCode ?? 0 }
        }
      }
    }),

    defineTool({
      name: 'job_kill',
      displayName: '终止任务',
      actionLabel: '终止任务',
      description: '终止一个正在运行的后台任务。',
      category: 'system',
      permission: 'once',
      params: [{ key: 'jobId', label: '任务 id', required: true }],
      execute: (args) => {
        const id = s(args, 'jobId')
        const ok = killJob(id)
        return {
          result: { killed: ok },
          summary: ok ? `已终止任务 ${id}` : `终止失败：${id}`,
          context: ok ? `任务 ${id} 已终止。` : `没能终止任务 ${id}。`
        }
      }
    })
  ]
}
