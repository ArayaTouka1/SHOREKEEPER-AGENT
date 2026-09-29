export interface CommandRule {
  id: string
  command: string
  effect: 'allow' | 'deny'
  createdAt: number
}

export interface WorkspaceSecurity {
  workspace: string
  trusted: boolean
  rules: CommandRule[]
  cachedApprovals: number
}

export interface DocumentData {
  path: string
  name: string
  ext: string
  size: number
  version: string
  kind: 'pdf' | 'docx' | 'slides' | 'sheet' | 'markdown' | 'text' | 'unsupported'
  text?: string
  bytes?: Uint8Array
  sheets?: { name: string; rows: string[][]; truncated: boolean }[]
}
