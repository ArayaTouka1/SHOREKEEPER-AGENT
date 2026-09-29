import { randomUUID } from 'node:crypto'
import type { ApprovalPrompt } from './workspaceSecurity'

type Input = Parameters<ApprovalPrompt>[0]
const pending = new Map<string, { input: Input; finish: (answer: 'once' | 'deny') => void }>()

export const requestOperationApproval: ApprovalPrompt = input => new Promise(resolve => {
  const id = randomUUID()
  const timer = setTimeout(() => finish('deny'), 120000)
  const finish = (answer: 'once' | 'deny'): void => {
    clearTimeout(timer)
    pending.delete(id)
    resolve(answer)
  }
  pending.set(id, { input, finish })
})

export function pendingOperationApprovals(): Array<Input & { id: string }> {
  return [...pending].map(([id, value]) => ({ id, ...value.input }))
}

export function decideOperationApproval(id: string, approved: boolean): boolean {
  const request = pending.get(id)
  if (!request || typeof approved !== 'boolean') return false
  request.finish(approved ? 'once' : 'deny')
  return true
}
