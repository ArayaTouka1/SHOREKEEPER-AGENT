import { JsonStore, uid, ensureDataDir } from './store'
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { Conversation, ChatMessage, MessageRole } from '../shared/types'

interface ChatState {
  conversations: Conversation[]
  messages: ChatMessage[]
}

let indexStore: JsonStore<Conversation[]> | undefined
const messageStores = new Map<string, JsonStore<ChatMessage[]>>()
const messageOwners = new Map<string, string>()

function messagesDir(): string {
  const dir = join(ensureDataDir(), 'chat-messages')
  mkdirSync(dir, { recursive: true })
  return dir
}

function messageStore(id: string): JsonStore<ChatMessage[]> {
  const cached = messageStores.get(id)
  if (cached) return cached
  const name = createHash('sha256').update(id).digest('hex')
  const store = new JsonStore<ChatMessage[]>(name, () => [], messagesDir())
  if (messageStores.size >= 8) {
    const oldest = messageStores.keys().next().value!
    messageStores.delete(oldest)
    for (const [message, owner] of messageOwners) if (owner === oldest) messageOwners.delete(message)
  }
  messageStores.set(id, store)
  return store
}

function conversationsStore(): JsonStore<Conversation[]> {
  if (indexStore) return indexStore
  const next = new JsonStore<Conversation[]>('chat-index', () => [])
  if (!existsSync(next.path)) {
    // Commit the index last. A failed migration can restart from the untouched legacy file.
    const legacyFile = join(ensureDataDir(), 'chat.json')
    const legacy = existsSync(legacyFile)
      ? new JsonStore<ChatState>('chat', () => ({ conversations: [], messages: [] })).read()
      : { conversations: [], messages: [] }
    const grouped = new Map<string, ChatMessage[]>()
    for (const message of legacy.messages) {
      const list = grouped.get(message.conversationId) ?? []
      list.push(message)
      grouped.set(message.conversationId, list)
    }
    for (const conversation of legacy.conversations) messageStore(conversation.id).write(grouped.get(conversation.id) ?? [])
    next.write(legacy.conversations)
  }
  indexStore = next
  return next
}

export const chatRepo = {
  conversations(characterId?: string): Conversation[] {
    const list = conversationsStore().read()
    const filtered = characterId ? list.filter((c) => c.characterId === characterId) : list
    return [...filtered].sort((a, b) => b.updatedAt - a.updatedAt)
  },

  create(characterId: string, title = '新对话'): Conversation {
    const now = Date.now()
    const conv: Conversation = {
      id: uid('conv'),
      characterId,
      title,
      summary: '',
      createdAt: now,
      updatedAt: now,
      messageCount: 0
    }
    conversationsStore()
    messageStore(conv.id).write([])
    conversationsStore().update((items) => { items.push(conv) })
    return conv
  },

  ensureConversation(characterId: string): Conversation {
    const existing = this.conversations(characterId)[0]
    if (existing) return existing
    return this.create(characterId)
  },

  delete(id: string): Conversation[] {
    conversationsStore().update((items) => items.filter((c) => c.id !== id))
    const file = messageStore(id).path
    if (existsSync(file)) unlinkSync(file)
    messageStores.delete(id)
    for (const [message, owner] of messageOwners) if (owner === id) messageOwners.delete(message)
    return this.conversations()
  },

  messages(conversationId: string): ChatMessage[] {
    if (!conversationsStore().read().some(c => c.id === conversationId)) return []
    const messages = messageStore(conversationId).read()
    for (const message of messages) messageOwners.set(message.id, conversationId)
    return [...messages].sort((a, b) => a.createdAt - b.createdAt)
  },

  append(input: {
    conversationId: string
    role: MessageRole
    text: string
    toolCall?: ChatMessage['toolCall']
    images?: ChatMessage['images']
    proactive?: boolean
    attachments?: ChatMessage['attachments']
  }): ChatMessage {
    const now = Date.now()
    const msg: ChatMessage = {
      id: uid('msg'),
      conversationId: input.conversationId,
      role: input.role,
      text: input.text,
      createdAt: now,
      toolCall: input.toolCall,
      images: input.images,
      attachments: input.attachments,
      proactive: input.proactive
    }
    if (!conversationsStore().read().some(c => c.id === input.conversationId)) throw new Error('会话已结束或不存在')
    messageStore(input.conversationId).update((items) => {
      if (items.length >= 800) items.slice(0, items.length - 799).forEach(item => messageOwners.delete(item.id))
      return [...items, msg].slice(-800)
    })
    messageOwners.set(msg.id, input.conversationId)
    conversationsStore().update((items) => {
      const conv = items.find((c) => c.id === input.conversationId)
      if (conv) {
        conv.messageCount += 1
        conv.updatedAt = now
        if (input.role === 'user' && (conv.title === '新对话' || !conv.title)) {
          conv.title = input.text.slice(0, 18) || '[图片]'
        }
        if (input.role === 'character' || input.role === 'user') {
          conv.summary = input.text.slice(0, 46) || '[表情包]'
        }
      }
    })
    return msg
  },

  recentStickerIds(conversationId: string, n = 8): string[] {
    const recent = this.messages(conversationId).slice(-n)
    const out: string[] = []
    for (const m of recent) {
      for (const img of m.images ?? []) {
        if (img.sticker && img.name) out.push(img.name)
        else if (img.sticker && img.path) out.push(img.path.split(/[\\/]/).pop() ?? '')
      }
    }
    return out.filter(Boolean)
  },

  updateMessage(id: string, patch: Partial<ChatMessage>): ChatMessage | null {
    let out: ChatMessage | null = null
    const owner = messageOwners.get(id) ?? this.conversations().find(c => this.messages(c.id).some(m => m.id === id))?.id
    if (!owner) return null
    messageStore(owner).update((items) => {
      const idx = items.findIndex((m) => m.id === id)
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...patch, id, conversationId: owner }
        out = items[idx]
      }
    })
    return out
  },

  recent(conversationId: string, n = 20): ChatMessage[] {
    const all = this.messages(conversationId)
    return all.slice(-n)
  }
}
