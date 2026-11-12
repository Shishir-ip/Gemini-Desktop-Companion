/* Feature screenshot session over YouTube: node scripts/take-screenshots.mjs */
import { writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const port = process.argv[2] ?? '9222'
const outDir = 'docs/screenshots'
mkdirSync(outDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const list = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()

function conn(t) {
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let id = 0
  const pend = new Map()
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } }
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id
    const to = setTimeout(() => { if (pend.has(i)) { pend.delete(i); r({ timeout: true }) } }, 15000)
    pend.set(i, (m) => { clearTimeout(to); r(m) })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.result?.value
  return { ws, ready, send, ev }
}
const find = async (frag) => (await list()).find((t) => t.type === 'page' && t.url.includes(frag))

// DPI-aware full-screen capture (physical pixels)
function screen(name) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
try { Add-Type -Namespace Gdc -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);'; [Gdc.Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$b = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, (New-Object System.Drawing.Size $vs.Width, $vs.Height))
$g.Dispose()
$b.Save('${outDir}/${name}.png', [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose()
`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true })
  console.log(`  📸 ${name}.png`)
}
async function drag(c, x1, y1, x2, y2, hold = false) {
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', clickCount: 1 })
  for (let i = 1; i <= 10; i++) {
    await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x1 + (x2 - x1) * i / 10), y: Math.round(y1 + (y2 - y1) * i / 10), button: 'left' })
    await sleep(30)
  }
  if (!hold) await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', clickCount: 1 })
}
const esc = async (c) => {
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
}

// ── 01 Home ──────────────────────────────────────────────────────────────
const home = conn(await find('renderer/home'))
await home.ready
await home.send('Runtime.enable')
await sleep(1200)
screen('01-home')
await esc(home)
await sleep(700)

// ── 02/03/04 Circle to Search ───────────────────────────────────────────
await home.ev(`window.gdc.app.startCircleToSearch()`)
await sleep(1400)
const circle = conn(await find('renderer/circle'))
await circle.ready
await circle.send('Runtime.enable')
await sleep(800)
screen('02-circle-to-search-glow')
await drag(circle, 280, 260, 980, 640, true) // hold the selection
await sleep(500)
screen('03-selection')
await circle.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 980, y: 640, button: 'left', clickCount: 1 })
console.log('  waiting for Lens results…')
await sleep(13000)
screen('04-lens-results')
await esc(circle)
await sleep(900)

// ── 05 Gemini pill ──────────────────────────────────────────────────────
await home.ev(`window.gdc.app.showGemini()`)
await sleep(1300)
const gem = conn(await find('renderer/gemini'))
await gem.ready
await gem.send('Runtime.enable')
await sleep(500)
screen('05-gemini-pill')

// ── 06 Gemini chat with a real answer about the screen ─────────────────
await gem.ev(`document.getElementById('btn-attach').click()`)
await sleep(1700)
const circle2 = conn(await find('renderer/circle'))
await circle2.ready
await circle2.send('Runtime.enable')
await drag(circle2, 200, 180, 900, 560)
await sleep(2000)
await gem.ev(`(() => { const p = document.getElementById('prompt'); p.value = 'What is visible in this screenshot? Answer in one short sentence.'; p.dispatchEvent(new Event('input')); return true })()`)
await gem.ev(`document.getElementById('btn-send').click()`)
console.log('  waiting for Gemini answer…')
await sleep(11000)
screen('06-gemini-chat')
circle2.ws.close()

// ── 07 Settings ─────────────────────────────────────────────────────────
await gem.ev(`window.gdc.settings.open()`)
await sleep(1500)
const set = conn(await find('renderer/settings'))
await set.ready
await set.send('Runtime.enable')
await sleep(500)
screen('07-settings')
await set.ev(`window.gdc.win.close()`)
await sleep(700)

// ── 08 Light theme ──────────────────────────────────────────────────────
await gem.ev(`window.gdc.settings.setTheme('light')`)
await sleep(900)
await gem.ev(`window.gdc.app.showGemini()`)
await sleep(900)
screen('08-light-theme')
await gem.ev(`window.gdc.settings.setTheme('dark')`)
await sleep(500)

home.ws.close(); circle.ws.close(); gem.ws.close(); set.ws.close()
console.log('done')
process.exit(0)