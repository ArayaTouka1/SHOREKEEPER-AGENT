/** Owns one active generation per conversation, including preparation and tools. */
export class ConversationTurns {
  private readonly active = new Map<string, AbortController>()

  start(id: string, timeoutMs = 120000) {
    this.cancel(id)
    const controller = new AbortController()
    this.active.set(id, controller)
    const timer = setTimeout(() => controller.abort(new DOMException('等待模型回复超时，请检查连接后重试', 'TimeoutError')), timeoutMs)
    controller.signal.addEventListener('abort', () => clearTimeout(timer), { once: true })
    timer.unref?.()
    return {
      controller,
      isCurrent: () => this.active.get(id) === controller,
      finish: () => {
        clearTimeout(timer)
        if (this.active.get(id) === controller) this.active.delete(id)
      }
    }
  }

  cancel(id: string): void {
    this.active.get(id)?.abort()
    this.active.delete(id)
  }
}
