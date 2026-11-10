/**
 * Stale-surface visual probe — replicates the user's exact flow:
 *   1. session 1 frozen (caller ensures it's up)
 *   2. dismiss via CDP (immune to OS focus), screen content changes
 *   3. hotkey via PowerShell spawn (real user path)
 *   4. probe the overlay surface IMMEDIATELY at open (~150ms): the previous
 *      screenshot must NOT be in the <img>
 *   5. wait frozen, checksum vs session 1
 * Usage: node scripts/e2e-stale-visual.mjs 9333
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = process.argv[2] ?? '9333'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function findCircle(timeoutMs = 12000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const c = list.find((t) => t.type === 'page' && t.url.includes('renderer/circle/index.html'))
      if (c) return c
    } catch { /* retry */ }
    await sleep(30)
  }
  return null
}

function connect(target) {
  return new Promise(async (resolve) => {
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
    resolve({ ws, send, evaluate })
  })
}

const CHECKSUM = `
  (() => {
    const img = document.getElementById('shot')
    const src = img.src || ''
    let h = 0
    for (let i = 0; i < src.length; i += 97) h = (h * 31 + src.charCodeAt(i)) >>> 0
    return JSON.stringify({ srcLen: src.length, hash: h, natW: img.naturalWidth })
  })()
`

// ── Step 1: checksum session 1's frozen frame ─────────────────────────────
let target = await findCircle()
if (!target) { console.log('no overlay target — trigger session 1 first'); process.exit(1) }
let { ws, send, evaluate } = await connect(target)
await send('Runtime.enable')
const sum1 = JSON.parse(await evaluate(CHECKSUM))
console.log(`SESSION-1 frame: len=${sum1.srcLen} hash=${sum1.hash} natW=${sum1.natW}`)

// ── Step 2: dismiss via CDP + change screen content ───────────────────────
await evaluate(`window.gdc.circle.dismissAll()`)
await sleep(1000)
spawn('cmd.exe', ['/c', 'start', 'notepad'], { detached: true, stdio: 'ignore' }).unref()
await sleep(2500)
console.log('dismissed (CDP) + notepad spawned')

// ── Step 3: fire the real hotkey ──────────────────────────────────────────
spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/send-keys.ps1', 'circle'], { stdio: 'ignore' }).unref()

// ── Step 4: probe the surface as early as possible after open ─────────────
const tHot = Date.now()
target = await findCircle()
if (!target) { console.log('no overlay target after hotkey'); process.exit(1) }
;({ ws, send, evaluate } = await connect(target))
await send('Runtime.enable')
await sleep(Math.max(0, 180 - (Date.now() - tHot)))
const probe = await evaluate(`JSON.stringify({
  srcPrefix: (document.getElementById('shot').src || '').slice(0, 32),
  srcLen: (document.getElementById('shot').src || '').length,
  natW: document.getElementById('shot').naturalWidth,
  hint: document.getElementById('hint-text').textContent
})`)
console.log(`probe@open+${Date.now() - tHot}ms:`, probe)

const shot = await send('Page.captureScreenshot', { format: 'png' })
const shotPath = join(tmpdir(), 'overlay-at-open.png')
writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'))
console.log('visual probe saved:', shotPath)

// ── Step 5: wait frozen, compare ──────────────────────────────────────────
let sum2 = null
const tF = Date.now()
while (Date.now() - tF < 15000) {
  const st = await evaluate(CHECKSUM)
  if (st) {
    const s = JSON.parse(st)
    if (s.natW > 10) { sum2 = s; break }
  }
  await sleep(100)
}
if (!sum2) { console.log('SESSION-2 never froze'); process.exit(1) }
console.log(`SESSION-2 frame: len=${sum2.srcLen} hash=${sum2.hash} natW=${sum2.natW} (froze ${Date.now() - tF}ms after probe)`)
const staleEarly = sum1.srcLen === JSON.parse(probe).srcLen && JSON.parse(probe).natW > 10
console.log(staleEarly ? 'STALE SURFACE AT OPEN: previous screenshot was displayed' : 'CLEAN AT OPEN: dim-only surface')
console.log(sum1.hash === sum2.hash ? 'STALE CAPTURE: same frame as session 1' : 'FRESH CAPTURE: frames differ')
process.exit(0)
