/**
 * Redesign verification: wake latency, glow state, drag → lossless crop,
 * panel surfaces. Launch the app first:
 *   electron . --remote-debugging-port=9222 --gdc-open=home
 * then: node scripts/verify-redesign.mjs [port] [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] ?? '9222'
const outDir = process.argv[3] ?? 'gdc-verify'
mkdirSync(outDir, { recursive: true })

const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let msgId = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') {
      errors.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '?').slice(0, 300))
    }
  }
  const send = (method, params = {}) => new Promise((r) => {
    const id = ++msgId
    pending.set(id, r)
    const t = setTimeout(() => { if (pending.has(id)) { pending.delete(id); r({ timeout: true }) } }, 12000)
    const orig = r
    pending.set(id, (m) => { clearTimeout(t); orig(m) })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }))?.result?.result?.value
  const shot = async (name) => {
    const res = await send('Page.captureScreenshot', { format: 'png' })
    const data = res?.result?.data
    if (data) { writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, 'base64')); console.log(`  shot: ${name}.png`) }
    else console.log(`  shot FAILED: ${name}`)
  }
  return { ws, ready, send, evaluate, shot, errors }
}

const find = async (frag) => (await list()).find((t) => t.type === 'page' && t.url.includes(frag))

// ── 1. Control surface (home, else settings/gemini) ─────────────────────
const homeT =
  (await find('renderer/home/index.html')) ??
  (await find('renderer/settings/index.html')) ??
  (await find('renderer/gemini/index.html'))
if (!homeT) { console.error('no control target — is the app running?'); process.exit(1) }
const home = connect(homeT)
await home.ready
await home.send('Runtime.enable')
await sleep(600)
console.log('CONTROL state:', await home.evaluate(`document.readyState + ' / nodes=' + document.body.children.length`))
if (homeT.url.includes('home')) await home.shot('home')

// ── 2. Wake Circle to Search + measure latency ──────────────────────────
console.log('\nWaking Circle to Search…')
const t0 = Date.now()
await home.evaluate(`window.gdc.app.startCircleToSearch()`)
let circle = null
for (let i = 0; i < 40; i++) {
  await sleep(100)
  const t = await find('renderer/circle/index.html')
  if (t) {
    const c = connect(t)
    await c.ready
    await c.send('Runtime.enable')
    const state = await c.evaluate(`document.body.className`)
    if (state && state.includes('ready')) { circle = c; break }
    c.ws.close()
  }
}
const wakeMs = Date.now() - t0
if (!circle) { console.error('circle never became ready'); process.exit(1) }
console.log(`CIRCLE ready in ~${wakeMs}ms (includes 100ms poll granularity)`)
console.log('CIRCLE body classes:', await circle.evaluate(`document.body.className`))
console.log('CIRCLE frozen frame:', await circle.evaluate(`(() => { const i = document.getElementById('shot'); return i.naturalWidth + 'x' + i.naturalHeight })()`))
await sleep(700) // let the glow settle for the screenshot
await circle.shot('circle-glow')

// ── 3. Drag a selection → lossless crop in main ─────────────────────────
await circle.evaluate(`
  window.__trace = []
  const orig = window.gdc.circle.selectRect
  window.gdc.circle.selectRect = (r) => { window.__trace.push(JSON.stringify(r)); return orig(r) }
  'hooked'
`)
const drag = async (x1, y1, x2, y2) => {
  await circle.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 8; i++) {
    await circle.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x1 + (x2 - x1) * i / 8), y: Math.round(y1 + (y2 - y1) * i / 8), button: 'left' })
    await sleep(24)
  }
  await circle.shot('circle-selection')
  await circle.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
}
await drag(140, 140, 560, 380)
await sleep(1600)
console.log('DRAG trace:', await circle.evaluate(`JSON.stringify(window.__trace)`))
console.log('CIRCLE lens-mode:', await circle.evaluate(`document.body.classList.contains('lens-mode')`))

// ── 4. Results panel + crop cleanliness ─────────────────────────────────
const panelT = await find('lens-upload.html') ?? (await list()).find((t) => t.type === 'page' && /google\.|lens/.test(t.url) && !t.url.includes('renderer'))
if (panelT) {
  const panel = connect(panelT)
  await panel.ready
  await panel.send('Runtime.enable')
  await sleep(800)
  const crop = await panel.evaluate(`window.gdc && window.gdc.lens ? window.gdc.lens.getCrop() : null`)
  if (typeof crop === 'string' && crop.startsWith('data:image/png')) {
    writeFileSync(join(outDir, 'crop.png'), Buffer.from(crop.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
    console.log('CROP saved: crop.png (lossless PNG from main,', Math.round(crop.length * 3 / 4 / 1024), 'KB)')
  } else {
    console.log('CROP unavailable on panel target:', String(crop).slice(0, 80))
  }
  await panel.shot('lens-panel')
  panel.ws.close()
} else {
  console.log('no results panel target found')
}

// ── 5. Esc dismiss, then Gemini widget + Settings ───────────────────────
await circle.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await circle.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await sleep(700)
console.log('\nAfter Esc — remaining targets:', (await list()).filter((t) => t.type === 'page').map((t) => t.url.split('/').pop()).join(', '))
circle.ws.close()

await home.evaluate(`window.gdc.app.showGemini()`)
await sleep(1200)
const gemT = await find('renderer/gemini/index.html')
if (gemT) {
  const gem = connect(gemT)
  await gem.ready
  await gem.send('Runtime.enable')
  await sleep(500)
  console.log('GEMINI body classes:', await gem.evaluate(`document.body.className`))
  await gem.shot('gemini-panel')
  if (gem.errors.length) console.log('GEMINI exceptions:', gem.errors)
  gem.ws.close()
}
await home.evaluate(`window.gdc.settings.open()`)
await sleep(1200)
const setT = await find('renderer/settings/index.html')
if (setT) {
  const set = connect(setT)
  await set.ready
  await set.send('Runtime.enable')
  await sleep(500)
  await set.shot('settings')
  console.log('SETTINGS prefs row present:', await set.evaluate(`!!document.getElementById('pref-glow') && !!document.getElementById('glow-intensity')`))
  if (set.errors.length) console.log('SETTINGS exceptions:', set.errors)
  set.ws.close()
}

console.log('\nHOME exceptions:', home.errors.length ? home.errors : '(none)')
home.ws.close()
console.log('done')