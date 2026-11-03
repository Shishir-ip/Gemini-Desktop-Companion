/**
 * Definitive streaming test: submit a prompt, poll extraction properties.
 * Usage: node scripts/inspect-gemini3.mjs 9222
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
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value ?? JSON.stringify(r?.result)
}

console.log('submit:', await evaluate(`(async () => {
  if (!window.__gdcSubmit) return 'NO BRIDGE'
  return JSON.stringify(await window.__gdcSubmit({ text: 'Reply with exactly: OK', imageB64: null }), null, 0)
})()`))

for (let i = 0; i < 26; i++) {
  await new Promise((r) => setTimeout(r, 2500))
  const sample = await evaluate(`(() => {
    const nodes = document.querySelectorAll('model-response, message-content, .conversation-container')
    if (!nodes.length) return JSON.stringify({ nodes: 0 })
    const el = nodes[nodes.length - 1]
    const md = el.querySelector('.markdown') || el
    return JSON.stringify({
      nodes: nodes.length,
      tag: el.tagName,
      textContentLen: (md.textContent || '').trim().length,
      textContent: (md.textContent || '').trim().slice(0, 80),
      innerTextLen: (md.innerText || '').trim().length,
      visible: typeof md.checkVisibility === 'function' ? md.checkVisibility() : 'n/a',
      bodyTail: (document.body.innerText || '').slice(-120).replace(/\\n/g, ' | ')
    })
  })()`)
  console.log(`t+${((i + 1) * 2.5)}s:`, sample)
  if (sample.includes('"textContentLen":') && /OK/.test(sample)) break
}
ws.close()
