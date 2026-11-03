import { net, session } from 'electron'
import type { NetworkConfig } from '../shared/types'

/** Use Chromium's network stack so model and web requests share Electron's proxy/VPN setup. */
export async function appFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const chromiumFetch = (net as unknown as { fetch?: typeof fetch })?.fetch
  if (typeof chromiumFetch === 'function') return chromiumFetch(input.toString(), init)
  return fetch(input, init)
}

export async function applyNetworkConfig(config: NetworkConfig): Promise<void> {
  const target = session.defaultSession
  if (!target) return
  if (config.mode === 'fixed') {
    const rules = config.proxyRules.trim()
    // Keep the app online while the user is still typing the proxy address.
    if (!rules) {
      await target.setProxy({ mode: 'system' })
      await target.closeAllConnections()
      return
    }
    await target.setProxy({
      mode: 'fixed_servers',
      proxyRules: rules,
      proxyBypassRules: config.proxyBypassRules.trim() || '<local>'
    })
  } else {
    await target.setProxy({ mode: config.mode === 'direct' ? 'direct' : 'system' })
  }
  await target.closeAllConnections()
}
