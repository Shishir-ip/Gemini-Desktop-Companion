/* Final round-2 verification: node scripts/verify-final.mjs */
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const port = process.argv[2] ?? '9222'
const outDir = process.argv[3] ?? 'gdc-verify'
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
function conn(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pend = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
    else if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.exception?.description ?? '?').slice(0, 200))
  }
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id
    const to = setTimeout(() => { if (pend.has(i)) { pend.delete(i); r({ timeout: true }) } }, 15000)
    pend.set(i, (m) => { clearTimeout(to); r(m) })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.result?.value
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    if (r?.result?.data) { writeFileSync(`${outDir}/${name}.png`, Buffer.from(r.result.data, 'base64')); console.log(`  shot: ${name}`) }
  }
  return { ws, ready, send, ev, shot, errors }
}
const find = async (frag) => (await list()).find((t) => t.type === 'page' && t.url.includes(frag))

// 0. No glow window anywhere
const targets = await list()
console.log('glow targets (must be 0):', targets.filter((t) => t.url.includes('glow')).length)

const gem = conn(await find('renderer/gemini'))
await gem.ready
await gem.send('Runtime.enable')
await gem.ev(`window.gdc.app.showGemini()`)
await sleep(900)

// 1. Pill geometry on the real desktop
const bounds = await gem.ev(`JSON.stringify({ w: window.innerWidth, h: window.innerHeight, screenH: window.screen.height, availH: window.screen.availHeight })`)
console.log('pill window:', bounds)
const ps = `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $vs=[System.Windows.Forms.SystemInformation]::VirtualScreen; $b=New-Object System.Drawing.Bitmap $vs.Width,$vs.Height; $g=[System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($vs.X,$vs.Y,0,0,(New-Object System.Drawing.Size $vs.Width,$vs.Height)); $g.Dispose(); $b.Save('${outDir}/pill-desktop.png',[System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose()`
execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true })
console.log('  shot: pill-desktop (full screen)')
await gem.shot('pill')

// 2. Attach #1 → submit → Attach #2 (the reported bug flow)
async function attach(x2, y2) {
  await gem.ev(`document.getElementById('btn-attach').click()`)
  await sleep(1700)
  const circle = conn(await find('renderer/circle'))
  await circle.ready
  await circle.send('Runtime.enable')
  await circle.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 120, y: 120, button: 'left', clickCount: 1 })
  await circle.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x2, y: y2, button: 'left' })
  await circle.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
  await sleep(1800)
  circle.ws.close()
}
await gem.ev(`window.gdc.gemini.newChat()`)
await gem.ev(`window.gdc.gemini.removeAttachment()`)
await sleep(300)
await attach(420, 320)
console.log('attach#1 chip:', await gem.ev(`document.getElementById('attachment-chip').hidden ? 'HIDDEN' : 'shown'`))
await gem.ev(`(() => { const p = document.getElementById('prompt'); p.value = 'Describe this in one short sentence.'; p.dispatchEvent(new Event('input')); return true })()`)
await gem.ev(`document.getElementById('btn-send').click()`)
await sleep(8000)
await attach(640, 460)
const chip2 = await gem.ev(`JSON.stringify({ hidden: document.getElementById('attachment-chip').hidden, len: (document.getElementById('attachment-thumb').src||'').length, qa: !document.getElementById('quick-actions').hidden })`)
console.log('attach#2 after submit:', chip2)
await gem.shot('chat-attach2')

// 3. New Chat capsule + Minimise
console.log('sheet-top buttons:', await gem.ev(`Array.from(document.querySelector('.sheet-top').querySelectorAll('button')).map(b => b.id + ':' + (b.textContent.trim() || 'icon')).join(' | ')`))
await gem.ev(`document.getElementById('btn-newchat').click()`)
await sleep(600)
console.log('after New Chat: sheetHidden=', await gem.ev(`document.getElementById('chat-sheet').hidden`), 'msgs=', await gem.ev(`document.querySelectorAll('#messages .msg').length`))
await gem.ev(`window.gdc.app.showGemini()`)
await sleep(500)

// 4. Light theme
await gem.ev(`window.gdc.settings.setTheme('light')`)
await sleep(700)
await gem.shot('pill-light')
await gem.ev(`window.gdc.settings.setTheme('dark')`)
await sleep(400)

// 5. Circle to Search still intact
await gem.ev(`window.gdc.app.startCircleToSearch()`)
await sleep(1500)
const circle = conn(await find('renderer/circle'))
await circle.ready
await circle.send('Runtime.enable')
console.log('circle body:', await circle.ev(`document.body.className`))
await circle.shot('circle-final')
await circle.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await circle.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
await sleep(600)

console.log('gemini exceptions:', gem.errors.length ? gem.errors : '(none)')
gem.ws.close(); circle.ws.close()
console.log('done')
process.exit(0)