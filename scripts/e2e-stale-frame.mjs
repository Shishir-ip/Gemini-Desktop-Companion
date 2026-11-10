/**
 * Stale-frame reproduction, two-phase:
 *   phase 1 — instrument the live overlay page, wait frozen, print checksum
 *   (caller: changes screen content, closes session, fires the hotkey again)
 *   phase 2 — reconnect to the SAME warm page, verify instrumentation
 *   survived, wait frozen, print checksum. Identical checksums = stale frame.
 * Usage: node scripts/e2e-stale-frame.mjs 9333 --phase=1|--phase=2
 */
const port = process.argv[2] ?? '9333'
const phase = process.argv.find((a) => a.startsWith('--phase'))?.split('=')[1] ?? '1'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CHECKSUM = `
  (() => {
    const img = document.getElementById('shot')
    const src = img.src || ''
    let h = 0
    for (let i = 0; i < src.length; i += 97) h = (h * 31 + src.charCodeAt(i)) >>> 0
    return JSON.stringify({ srcLen: src.length, hash: h, natW: img.naturalWidth, frozen: !!img.naturalWidth })
  })()
`

async function findCircle(timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const c = list.find((t) => t.type === 'page' && t.url.includes('renderer/circle/index.html'))
      if (c) return c
    } catch { /* retry */ }
    await sleep(60)
  }
  return null
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pending = new Map()
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value
  return { ws, send, evaluate }
}

async function waitForFrozen(evaluate, label, timeoutMs = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const st = await evaluate(CHECKSUM)
    if (st) {
      const s = JSON.parse(st)
      if (s.frozen) {
        console.log(`${label}: frozen after ${Date.now() - t0}ms checksum=${s.srcLen}:${s.hash}`)
        const dbg = await evaluate(`JSON.stringify((window.__dbg || []).slice(-6))`)
        console.log(`${label}: events=${dbg}`)
        return `${s.srcLen}:${s.hash}`
      }
    }
    await sleep(120)
  }
  console.log(`${label}: TIMEOUT waiting for frozen frame`)
  return null
}

const target = await findCircle()
if (!target) { console.log(`no circle target (phase ${phase})`); process.exit(1) }
const { ws, evaluate } = await connect(target)

if (phase === '1') {
  await evaluate(`
    (window.__dbg = window.__dbg || [])
    window.gdc.circle.onSetImage((p) => window.__dbg.push({ t: Date.now() % 100000, waiting: !p || !p.dataUrl, len: p && p.dataUrl ? p.dataUrl.length : 0 }))
    'ok'
  `)
  const sum = await waitForFrozen(evaluate, 'SESSION-1')
  console.log('PHASE1-CHECKSUM=' + sum)
} else {
  const state = await evaluate(`JSON.stringify({ hasDbg: Array.isArray(window.__dbg), dbgLen: (window.__dbg || []).length })`)
  console.log('phase2 same-page check:', state)
  const sum = await waitForFrozen(evaluate, 'SESSION-2')
  console.log('PHASE2-CHECKSUM=' + sum)
}
ws.close()
process.exit(0)
