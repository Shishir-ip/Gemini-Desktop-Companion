/**
 * Deep-dive #2: confirm textContent vs innerText, sign-in markers,
 * attach button labels, aria-live regions.
 * Usage: node scripts/inspect-gemini2.mjs 9222
 */
const port = process.argv[2] ?? '9222'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('gemini.google.com'))
if (!target) { console.error('no gemini target'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true })
  return r?.result?.result?.value ?? JSON.stringify(r?.result)
}

console.log(await evaluate(`(() => {
  const out = {}
  const mr = document.querySelector('model-response')
  const mc = document.querySelector('message-content')
  const md = document.querySelector('.markdown')
  out.modelResponseTextContent = mr ? mr.textContent.trim().slice(0, 300) : '(none)'
  out.modelResponseInnerText = mr ? mr.innerText.trim().slice(0, 300) : '(none)'
  out.modelResponseVisible = mr ? mr.checkVisibility() : null
  out.messageContentTextContent = mc ? mc.textContent.trim().slice(0, 300) : '(none)'
  out.markdownTextContent = md ? md.textContent.trim().slice(0, 300) : '(none)'
  out.markdownOuterHTML = md ? md.outerHTML.slice(0, 500) : '(none)'
  // aria-live regions
  out.ariaLive = [...document.querySelectorAll('[aria-live]')].map((el) => ({
    text: (el.textContent || '').trim().slice(0, 120),
    visible: el.checkVisibility()
  }))
  // sign-in markers
  const signInLink = document.querySelector('a[href*="accounts.google.com"]')
  out.signInLinkHref = signInLink ? signInLink.getAttribute('href').slice(0, 80) : null
  out.signInLinkText = signInLink ? signInLink.innerText.trim().slice(0, 40) : null
  out.avatar = !!document.querySelector('img.gbii, img.gbs, a[aria-label*="Google Account" i], [data-ogsr-up]')
  out.bodyHasSignInText = /\\bSign in\\b/.test(document.body.innerText || '')
  // attach / upload buttons
  out.uploadButtons = [...document.querySelectorAll('button')].
    map((b) => (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '')).
    filter((l) => l && /add|file|upload|attach|image|plus/i.test(l)).slice(0, 12)
  out.fileInputs = document.querySelectorAll('input[type=file]').length
  out.iframes = document.querySelectorAll('iframe').length
  return JSON.stringify(out, null, 1)
})()`))
ws.close()
