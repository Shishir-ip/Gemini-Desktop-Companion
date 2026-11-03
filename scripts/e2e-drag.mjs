/**
 * E2E drag test v2 — captures renderer console + exceptions during the drag.
 */
const port = process.argv[2] ?? '9222'
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const circle = list.find((t) => t.type === 'page' && t.url.includes('renderer/circle/index.html'))
if (!circle) { console.error('no circle target'); process.exit(1) }

const ws = new WebSocket(circle.webSocketDebuggerUrl)
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
    logs.push('EXC: ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '?').slice(0, 300))
  }
}
const send = (method, params = {}) => new Promise((r) => { const id = ++msgId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value

await send('Runtime.enable')

// Trap the IPC path so we can see exactly what happens.
await evaluate(`
  window.__trace = []
  const orig = window.gdc.circle.selectFinished
  window.gdc.circle.selectFinished = (d) => { window.__trace.push('selectFinished called, len=' + (d||'').length); return orig(d).then((r) => { window.__trace.push('selectFinished resolved'); return r }, (e) => { window.__trace.push('selectFinished REJECTED: ' + e); throw e }) }
  'hooked'
`)

const drag = async (x1, y1, x2, y2) => {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x1 + (x2 - x1) * i / 8), y: Math.round(y1 + (y2 - y1) * i / 8), button: 'left' })
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
}

await drag(120, 120, 420, 320)
await new Promise((r) => setTimeout(r, 1200))

console.log('trace:', await evaluate(`JSON.stringify(window.__trace)`))
console.log('selBox display:', await evaluate(`document.getElementById('sel-box').style.display`))
console.log('lens-mode:', await evaluate(`document.body.classList.contains('lens-mode')`))
console.log('renderer console:')
for (const l of logs.slice(-8)) console.log('  ', l)
ws.close()
