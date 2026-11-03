const { chromium } = require('@playwright/test')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
async function main() {
  const output = path.resolve('.verification/chat-reference')
  fs.mkdirSync(output, { recursive: true })
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await chromium.launch({ channel: 'msedge', headless: true, env })
  try {
    const page = await app.newPage({ viewport: { width: 1440, height: 900 } })
    const video = path.resolve('../对话ui参考/Wuthering Waves 2026.10.08 - 11.51.07.01.mp4')
    await page.goto(pathToFileURL(video).href)
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
    const duration = await page.locator('video').evaluate(v => { v.pause(); v.muted = true; return v.duration })
    console.log({ duration })
    for (const seconds of [2, duration / 2, duration - 2]) {
      await page.locator('video').evaluate((v, t) => new Promise(resolve => { v.addEventListener('seeked', resolve, { once: true }); v.currentTime = t }), seconds)
      await page.screenshot({ path: path.join(output, `${Math.round(seconds)}.png`) })
    }
  } finally { await app.close() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
