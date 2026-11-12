/* Retake the glow shot at its brightest phase: node scripts/retake-glow.mjs */
import { execFileSync } from 'node:child_process'
const port = process.argv[2] ?? '9222'
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
    const to = setTimeout(() => { if (pend.has(i)) { pend.delete(i); r({ timeout: true }) } }, 12000)
    pend.set(i, (m) => { clearTimeout(to); r(m) })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }))?.result?.result?.value
  return { ws, ready, send, ev }
}
const find = async (frag) => (await list()).find((t) => t.type === 'page' && t.url.includes(frag))
function screen(name) {
  const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
try { Add-Type -Namespace Gdc -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);'; [Gdc.Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
$vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
$b = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
$g = [System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($vs.X, $vs.Y, 0, 0, (New-Object System.Drawing.Size $vs.Width, $vs.Height))
$g.Dispose()
$b.Save('${name}', [System.Drawing.Imaging.ImageFormat]::Png)
$b.Dispose()
`
  execFileSync('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true })
}
const esc = async (c) => {
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 })
}

const ctl = conn(await find('renderer/home') ?? await find('renderer/gemini') ?? await find('renderer/settings'))
await ctl.ready
await ctl.send('Runtime.enable')
await ctl.ev(`window.gdc.app.startCircleToSearch()`)
await sleep(1500)
const circle = conn(await find('renderer/circle'))
await circle.ready
// sample 8 frames across the breathing/crossfade cycle
for (let i = 0; i < 8; i++) {
  screen(`docs/screenshots/glow-candidate-${i}.png`)
  await sleep(450)
}
await esc(circle)
ctl.ws.close(); circle.ws.close()
console.log('candidates saved')
process.exit(0)