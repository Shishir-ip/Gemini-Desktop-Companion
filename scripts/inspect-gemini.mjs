/**
 * Ground-truth inspector for the logged-in Gemini web DOM.
 * Usage: launch the app with --remote-debugging-port=9222, then
 *   node scripts/inspect-gemini.mjs 9222 [--prompt]
 */
const port = process.argv[2] ?? '9222'
const shouldPrompt = process.argv.includes('--prompt')

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('gemini.google.com'))
if (!target) {
  console.error('no gemini.google.com target found. Targets:',
    list.map((t) => `${t.type}:${t.url.slice(0, 60)}`).join('\n'))
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let msgId = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++msgId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r?.result?.result?.value ?? r?.result?.error?.message ?? JSON.stringify(r?.result)
}

const DIAG = `(() => {
  const q = (s) => document.querySelectorAll(s).length
  const all = [...document.querySelectorAll('body *')]
  const tags = {}
  for (const el of all) {
    const t = el.tagName.toLowerCase()
    if (/response|message|turn|model|bard|cmark|chat|conversation|prose/i.test(t)) {
      tags[t] = (tags[t] || 0) + 1
    }
  }
  let shadowHosts = 0
  for (const el of all) { if (el.shadowRoot) shadowHosts++ }
  const candidates = {
    'model-response': q('model-response'),
    'message-content': q('message-content'),
    '.conversation-container': q('.conversation-container'),
    '.markdown': q('.markdown'),
    'user-query': q('user-query'),
    '[aria-live]': q('[aria-live]'),
    'rich-textarea': q('rich-textarea'),
    'ql-editor': q('.ql-editor'),
    'input[type=file]': q('input[type=file]')
  }
  let lastModelText = ''
  const mr = document.querySelectorAll('model-response, message-content')
  if (mr.length) {
    const el = mr[mr.length - 1]
    lastModelText = (el.innerText || '').slice(0, 300)
  }
  const openShadowSample = []
  for (const el of all) {
    if (el.shadowRoot && /response|message|model/i.test(el.tagName)) {
      openShadowSample.push(el.tagName + ' -> ' + (el.shadowRoot.textContent || '').slice(0, 120))
      if (openShadowSample.length >= 3) break
    }
  }
  return JSON.stringify({
    url: location.href.slice(0, 80),
    ready: document.readyState,
    bodyTextLen: (document.body.innerText || '').length,
    candidates,
    tags,
    shadowHosts,
    openShadowSample,
    lastModelText
  }, null, 1)
})()`

console.log('=== INITIAL STATE ===')
console.log(await evaluate(DIAG))

if (shouldPrompt) {
  console.log('\n=== SUBMITTING DIAGNOSTIC PROMPT ===')
  console.log(await evaluate(`(async () => {
    if (!window.__gdcSubmit) return 'NO BRIDGE — preload missing'
    const r = await window.__gdcSubmit({ text: 'Reply with exactly: OK', imageB64: null })
    return JSON.stringify(r)
  })()`))
  await new Promise((r) => setTimeout(r, 12000))
  console.log('\n=== AFTER RESPONSE ===')
  console.log(await evaluate(DIAG))
  console.log('\n=== EXTRACTION CANDIDATES ===')
  console.log(await evaluate(`(() => {
    const out = {}
    const tests = {
      'model-response > .markdown': () => { const n = document.querySelectorAll('model-response .markdown'); return n[n.length-1]?.innerText?.slice(0,200) },
      'message-content': () => { const n = document.querySelectorAll('message-content'); return n[n.length-1]?.innerText?.slice(0,200) },
      '.model-response-text': () => document.querySelector('.model-response-text')?.innerText?.slice(0,200),
      'ms-cmark-node': () => { const n = document.querySelectorAll('ms-cmark-node'); return n.length ? n[n.length-1]?.innerText?.slice(0,200) : null }
    }
    for (const [k, fn] of Object.entries(tests)) { try { out[k] = fn() } catch (e) { out[k] = 'ERR ' + e } }
    // body-diff preview: last 400 chars of body text
    out['bodyTextTail'] = (document.body.innerText || '').slice(-400)
    return JSON.stringify(out, null, 1)
  })()`))
}

ws.close()
