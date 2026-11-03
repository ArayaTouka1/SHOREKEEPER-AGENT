import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginInfo } from '../../../shared/types'

type ElectronStyle = React.CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const CHANGE_EVENT = 'shorekeeper:plugins-changed'

export function notifyPluginRuntimeChanged(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function cspFor(plugin: PluginInfo): string {
  const hosts = plugin.manifest.permissions.network.flatMap((host) => {
    const normalized = host.startsWith('*.') ? host : host
    return [`https://${normalized}`]
  }).join(' ')
  const mediaHosts = plugin.manifest.permissions.network.flatMap((host) => [`https://${host}`, `http://${host}`]).join(' ')
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    `connect-src ${hosts || "'none'"}`,
    `img-src data: ${hosts || ''}`,
    `media-src blob: data: ${mediaHosts || ''}`
  ].join('; ')
}

function widgetDocument(plugin: PluginInfo, html: string): string {
  const csp = cspFor(plugin).replace(/"/g, '&quot;')
  if (/<head[\s>]/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp}">`)
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${html}</body></html>`
}

export default function PluginRuntime(): React.ReactElement | null {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [widgetSizes, setWidgetSizes] = useState<Record<string, { width: number; height: number }>>({})
  const [widgetReady, setWidgetReady] = useState<Record<string, boolean>>({})
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const load = useCallback(async () => {
    const result = await window.aimis.plugin.list()
    if (result.ok && result.data) setPlugins(result.data.plugins.filter((plugin) => plugin.enabled && plugin.loaded))
  }, [])

  useEffect(() => {
    void load()
    window.addEventListener(CHANGE_EVENT, load)
    return () => window.removeEventListener(CHANGE_EVENT, load)
  }, [load])

  useEffect(() => {
    const onMessage = async (event: MessageEvent): Promise<void> => {
      const match = [...frames.current.entries()].find(([, frame]) => frame.contentWindow === event.source)
      if (!match || !event.data || typeof event.data !== 'object') return
      const [key, frame] = match
      const pluginId = key.split(':')[0]
      const plugin = plugins.find((item) => item.manifest.id === pluginId)
      if (!plugin) return
      const message = event.data as Record<string, unknown>
      if (message.type === 'plugin:ready') {
        setWidgetReady((current) => ({ ...current, [key]: true }))
        return
      }
      if (message.type === 'plugin:resize') {
        const width = Math.min(800, Math.max(56, Number(message.width) || 0))
        const height = Math.min(800, Math.max(56, Number(message.height) || 0))
        if (width && height) setWidgetSizes((current) => ({ ...current, [key]: { width, height } }))
        return
      }
      if (message.type === 'plugin:open-external' && plugin.manifest.permissions.externalLinks && typeof message.url === 'string') {
        if (/^https:\/\//i.test(message.url)) await window.aimis.system.openExternal(message.url)
        return
      }
      if (message.type === 'plugin:invoke' && typeof message.command === 'string') {
        const response = await window.aimis.plugin.invoke(pluginId, message.command, message.args)
        frame.contentWindow?.postMessage({ type: 'plugin:result', requestId: message.requestId, response }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [plugins])

  const styles = useMemo(() => plugins.flatMap((plugin) => plugin.ui.cssText
    ? [{ id: plugin.manifest.id, css: plugin.ui.cssText }]
    : []), [plugins])
  const widgets = useMemo(() => plugins.flatMap((plugin) => plugin.ui.widgets.map((widget) => ({ plugin, widget }))), [plugins])

  return (
    <>
      {styles.map((style) => <style key={style.id} data-plugin-style={style.id}>{style.css}</style>)}
      {widgets.map(({ plugin, widget }, index) => {
        const key = `${plugin.manifest.id}:${widget.id}`
        const size = widgetSizes[key]
        const vertical = widget.position.startsWith('top') ? { top: 42 + index * 12 } : { bottom: 18 + index * 12 }
        const horizontal = widget.position.endsWith('left') ? { left: 82 } : { right: 18 }
        return (
          <div
            key={key}
            data-plugin-widget={key}
            data-plugin-ready={widgetReady[key] ? '1' : '0'}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: 'fixed', ...vertical, ...horizontal,
              width: size?.width ?? widget.width,
              height: size?.height ?? widget.height,
              zIndex: 100,
              pointerEvents: 'auto',
              WebkitAppRegion: 'no-drag',
              transition: 'width 180ms ease, height 180ms ease'
            } as ElectronStyle}
          >
            <iframe
              ref={(node) => { if (node) frames.current.set(key, node); else frames.current.delete(key) }}
              title={widget.title}
              sandbox="allow-scripts allow-forms allow-downloads"
              srcDoc={widgetDocument(plugin, widget.html)}
              onLoad={() => setWidgetReady((current) => ({ ...current, [key]: true }))}
              style={{
                display: 'block', width: '100%', height: '100%', border: 0,
                background: 'transparent', pointerEvents: 'auto', WebkitAppRegion: 'no-drag'
              } as ElectronStyle}
            />
          </div>
        )
      })}
    </>
  )
}
