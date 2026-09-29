import { JsonStore, uid } from './store'
import type { Conversation, ChatMessage, MessageRole } from '../shared/types'

interface ChatState {
  conversations: Conversation[]
  messages: ChatMessage[]
}

export const chatStore = new JsonStore<ChatState>('chat', () => ({ conversations: [], messages: [] }))

export const chatRepo = {
  conversations(characterId?: string): Conversation[] {
    const list = chatStore.read().conversations
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
    chatStore.update((s) => {
      s.conversations.push(conv)
    })
    return conv
  },

  ensureConversation(characterId: string): Conversation {
    const existing = this.conversations(characterId)[0]
    if (existing) return existing
    return this.create(characterId)
  },

  delete(id: string): Conversation[] {
    chatStore.update((s) => {
      s.conversations = s.conversations.filter((c) => c.id !== id)
      s.messages = s.messages.filter((m) => m.conversationId !== id)
    })
    return this.conversations()
  },

  messages(conversationId: string): ChatMessage[] {
    return chatStore
      .read()
      .messages.filter((m) => m.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt)
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
    chatStore.update((s) => {
      s.messages.push(msg)
      const conv = s.conversations.find((c) => c.id === input.conversationId)
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
      const inConv = s.messages.filter((m) => m.conversationId === input.conversationId)
      if (inConv.length > 800) {
        const drop = new Set(
          inConv
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(0, inConv.length - 800)
            .map((m) => m.id)
        )
        s.messages = s.messages.filter((m) => !drop.has(m.id))
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
    chatStore.update((s) => {
      const idx = s.messages.findIndex((m) => m.id === id)
      if (idx >= 0) {
        s.messages[idx] = { ...s.messages[idx], ...patch }
        out = s.messages[idx]
      }
    })
    return out
  },

  recent(conversationId: string, n = 20): ChatMessage[] {
    const all = this.messages(conversationId)
    return all.slice(-n)
  }
}
