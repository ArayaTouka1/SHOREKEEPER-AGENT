const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('@playwright/test')
async function main() {
  const root = path.resolve('.verification/chat-appearance')
  fs.mkdirSync(root, { recursive: true })
  await require('esbuild').build({ entryPoints: ['src/renderer/src/pages/chat/ChatBubble.tsx'], outfile: path.join(root, 'bubble.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['react', 'react-dom'] })
  const React = require('react')
  const { renderToStaticMarkup } = require('react-dom/server')
  const Bubble = require(path.join(root, 'bubble.cjs')).default
  const avatar = 'data:image/png;base64,' + fs.readFileSync('build/icon.png').toString('base64')
  const messages = [ ['user','不不不，还是不用了。就这样的话，也可以见字如面。'], ['character','我知道了，你喜欢就好。'], ['character','总而言之，往后的路，请让我和你一起走下去吧。'] ]
  const markup = messages.map(([role,text], i) => renderToStaticMarkup(React.createElement(Bubble, { msg: { id: String(i), role, text }, avatar, userAvatar: avatar, showUserAvatar: true, showCharacterAvatar: true, characterName: '守岸人', bubbleStyle: 'resonance', onSpeak: () => {} }))).join('')
  const css = fs.readFileSync('src/renderer/src/styles/global.css','utf8') + fs.readFileSync('src/renderer/src/pages/chat/chat.css','utf8')
  const browser = await chromium.launch({ channel: 'msedge' })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 850 } })
    await page.setContent(`<style>${css} body{background:#3b4148;padding:25px}.chat-page-body{height:670px;--bubble-user:linear-gradient(110deg,#123e79,#123054);--bubble-char:#f5fafc}.chat-page-head{margin-top:0}.chat-markdown p{margin:0}</style><div class="page-head chat-page-head"><div><div class="chat-character-title">守岸人</div><div class="chat-character-subtitle">黑海岸接引人，嗯……代行中</div></div></div><div class="page-body chat-page-body"><div class="chat-stage" style="flex:1;display:flex;flex-direction:column"><div class="chat-scroll" style="padding:32px;flex:1">${markup}</div><div class="chat-composer-wrap" style="padding:18px 32px"><div class="chat-composer card" style="padding:18px">输入消息……</div></div></div></div>`)
    await page.screenshot({ path: path.join(root, 'layout-preview.png') })
    console.log('PASS actual ChatBubble markup renders with custom avatars and reference CSS')
  } finally { await browser.close() }
}
main().catch(e=>{console.error(e);process.exitCode=1})
