/**
 * Instant-open E2E — measures hotkey → overlay window latency.
 * Usage: node scripts/e2e-instant.mjs 9222
 * The caller triggers the OS hotkey (PowerShell keybd_event) first.
 */
const port = process.argv[2] ?? '9222'
const t0 = Date.now()
let circle = null
while (Date.now() - t0 < 15_000) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    circle = list.find((t) => t.type === 'page' && t.url.includes('renderer/circle/index.html'))
    if (circle) break
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 40))
}
if (!circle) {
  console.log('RESULT: overlay never appeared')
  process.exit(1)
}
console.log(`RESULT: circle overlay target appeared after ${Date.now() - t0}ms`)

const ws = new WebSocket(circle.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value

// Wait until the frozen frame is painted (or waiting state at minimum).
const deadline = Date.now() + 8000
let state = ''
while (Date.now() < deadline) {
  state = await evaluate(`JSON.stringify({
    ready: document.body.classList.contains('ready'),
    hint: document.getElementById('hint-text').textContent,
    frozen: !!document.getElementById('shot').naturalWidth
  })`)
  const s = JSON.parse(state)
  if (s.frozen) break
  await new Promise((r) => setTimeout(r, 100))
}
console.log('overlay state:', state)
ws.close()
