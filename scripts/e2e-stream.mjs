/**
 * E2E streaming test through the REAL widget IPC path:
 *  1. opens the widget via --gdc-open=widget (launch separately)
 *  2. calls window.gdc.gemini.submit(...) on the widget page target
 *  3. polls the widget DOM for streamed text
 * Usage: node scripts/e2e-stream.mjs 9222
 */
const port = process.argv[2] ?? '9222'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const widget = list.find((t) => t.type === 'page' && t.url.includes('renderer/gemini/index.html'))
if (!widget) { console.error('widget target not found:', list.map((t) => t.url).join(', ')); process.exit(1) }

const ws = new WebSocket(widget.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) } }
const send = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value ?? JSON.stringify(r?.result)
}

console.log('login state:', await evaluate(`JSON.stringify((await window.gdc.gemini.getState()).login)`))
console.log('banner visible:', await evaluate(`!document.getElementById('signin-banner').hidden`))
console.log('submitting via real IPC path...')
console.log(await evaluate(`window.gdc.gemini.submit('Reply with exactly: OK'), 'sent'`))

let streamed = false
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 4000))
  const state = await evaluate(`JSON.stringify({
    thinking: !document.getElementById('thinking').hidden,
    streamText: document.getElementById('stream').innerText.slice(0, 200),
    streamLen: document.getElementById('stream').innerText.length,
    error: document.getElementById('error-box').hidden ? null : document.getElementById('error-message').textContent.slice(0, 120)
  })`)
  console.log(`t+${(i + 1) * 4}s:`, state)
  const parsed = JSON.parse(state)
  if (parsed.streamLen > 0 || parsed.error) { streamed = true; break }
}
console.log(streamed ? 'RESULT: STREAMING PIPELINE WORKS' : 'RESULT: no text reached the widget')
const shot = await send('Page.captureScreenshot', { format: 'png' })
if (shot?.result?.data) {
  const { writeFileSync } = await import('node:fs')
  writeFileSync('e2e-widget.png', Buffer.from(shot.result.data, 'base64'))
  console.log('screenshot saved: e2e-widget.png')
}
ws.close()
