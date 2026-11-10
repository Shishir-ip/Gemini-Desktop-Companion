/**
 * Chat screenshot persistence E2E — reproduces the user's exact regression:
 * send a screenshot → get answer → send a SECOND text prompt → the first
 * user bubble must STILL show the screenshot.
 * Usage: node scripts/e2e-chat-image.mjs 9222 (palette must be open)
 */
const port = process.argv[2] ?? '9222'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const gemini = list.find((t) => t.type === 'page' && t.url.includes('renderer/gemini/index.html'))
if (!gemini) { console.error('no gemini palette target'); process.exit(1) }

const ws = new WebSocket(gemini.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let msgId = 0
const pending = new Map()
const logs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200))
  } else if (m.method === 'Runtime.exceptionThrown') {
    logs.push('EXC: ' + (m.params.exceptionDetails?.exception?.description ?? '?').slice(0, 300))
  }
}
const send = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value
await send('Runtime.enable')

const shotOf = () => evaluate(`JSON.stringify({
  bubbles: [...document.querySelectorAll('.msg.user .bubble')].map(b => ({
    text: (b.textContent || '').slice(0, 40),
    hasImg: !!b.querySelector('img.shot-thumb'),
    imgW: b.querySelector('img.shot-thumb')?.naturalWidth ?? 0
  })),
  modelBubbles: document.querySelectorAll('.msg.model').length
})`)

// 1. REAL attach flow: click the palette's attach button → selection overlay
//    opens in attach mode → a plain click attaches the whole screen.
const attachBtn = await evaluate(`document.getElementById('btn-attach')?.id ?? 'missing'`)
console.log('attach button:', attachBtn)
await evaluate(`document.getElementById('btn-attach').click()`)
// Wait for the circle overlay target to appear and freeze.
let circleTarget = null
const tA = Date.now()
while (Date.now() - tA < 15_000) {
  const l = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  circleTarget = l.find((t) => t.type === 'page' && t.url.includes('renderer/circle/index.html'))
  if (circleTarget) break
  await new Promise((r) => setTimeout(r, 100))
}
if (!circleTarget) { console.error('attach overlay never opened'); process.exit(1) }
const ws2 = new WebSocket(circleTarget.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws2.onopen = res; ws2.onerror = rej })
let mid = 0
const p2 = new Map()
ws2.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && p2.has(m.id)) { p2.get(m.id)(m); p2.delete(m.id) } }
const send2 = (method, params = {}) => new Promise((r) => { const id = ++mid; p2.set(id, r); ws2.send(JSON.stringify({ id, method, params })) })
// Wait for frozen frame, then drag a small region (keeps the upload tiny).
await new Promise((r) => setTimeout(r, 2500))
await send2('Input.dispatchMouseEvent', { type: 'mousePressed', x: 100, y: 100, button: 'left', clickCount: 1 })
for (let i = 1; i <= 6; i++) {
  await send2('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 100 + i * 20, y: 100 + i * 15, button: 'left' })
}
await send2('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 220, y: 190, button: 'left', clickCount: 1 })
ws2.close()
console.log('attach drag sent')
await new Promise((r) => setTimeout(r, 500))
console.log('after attach:', await shotOf())

const typeAndSend = async (text) => {
  await evaluate(`(() => {
    const p = document.getElementById('prompt')
    p.value = ${JSON.stringify(text)}
    p.dispatchEvent(new Event('input', { bubbles: true }))
    document.getElementById('btn-send').click()
    return 'sent'
  })()`)
}

// 2. Submit first prompt with the screenshot attached.
await typeAndSend('What color is this square? Answer in one word.')
console.log('submitted prompt 1')
const t0 = Date.now()

// 3. Wait for the model answer to finish (busy state off), hard-capped.
const waitIdle = async (minModels) => {
  const t = Date.now()
  while (Date.now() - t < 100_000) {
    const st = await evaluate(`JSON.stringify({
      models: document.querySelectorAll('.msg.model').length,
      idle: document.getElementById('btn-send').disabled
    })`)
    const s = JSON.parse(st)
    if (s.models >= minModels && s.idle) return s
    await new Promise((r) => setTimeout(r, 800))
  }
  return null
}
const r1 = await waitIdle(1)
console.log(`answer 1 after ${Date.now() - t0}ms; state:`, await shotOf())
if (!r1) { console.log('TIMEOUT waiting for answer 1'); ws.close(); process.exit(1) }

// 4. THE REGRESSION: submit a second, text-only prompt.
await typeAndSend('Reply with just: OK')
const r2 = await waitIdle(2)
const final = await shotOf()
console.log('FINAL after second prompt:', final)
if (!r2) console.log('TIMEOUT waiting for answer 2')

// 5. Verdict: first user bubble must still carry the screenshot.
const s = JSON.parse(final)
const first = s.bubbles[0]
const pass = first && first.hasImg && first.imgW > 0 && s.bubbles.length >= 2
console.log(pass ? 'PASS: screenshot persisted after second prompt' : 'FAIL: screenshot vanished')
for (const l of logs.slice(-6)) console.log('  log:', l)
ws.close()
process.exit(pass ? 0 : 1)
