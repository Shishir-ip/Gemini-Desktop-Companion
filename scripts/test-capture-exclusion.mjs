/**
 * Deterministic test: does setContentProtection(true) exclude a window from
 * desktopCapturer screen captures on this machine?
 *
 * Replicates the app's conditions exactly:
 *  - app.disableHardwareAcceleration() (as in production)
 *  - full-screen WHITE "desktop" window
 *  - full-screen transparent overlay painting a 34% black dim, ON TOP,
 *    with setContentProtection(true)
 *  - desktopCapturer screen capture, mean brightness measured
 *
 * Result ~255 → capture is clean (protection works, instant-open is safe)
 * Result ~167 → capture sees the dim (protection broken → need hide-until-capture)
 */
import { app, BrowserWindow, desktopCapturer, screen } from 'electron'

app.disableHardwareAcceleration()

const meanBrightness = (image) => {
  const size = image.getSize()
  const buf = image.getBitmap() // BGRA
  let sum = 0
  let n = 0
  for (let i = 0; i < buf.length; i += 4) {
    const b = buf[i]
    const g = buf[i + 1]
    const r = buf[i + 2]
    sum += 0.299 * r + 0.587 * g + 0.114 * b
    n++
  }
  return n ? Math.round(sum / n) : -1
}

app.whenReady().then(async () => {
  const { bounds } = screen.getPrimaryDisplay()

  const white = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false, backgroundColor: '#ffffff', show: false, alwaysOnTop: true
  })
  white.loadURL('data:text/html,<body style="margin:0;background:#fff"></body>')
  await new Promise((r) => white.once('ready-to-show', r))
  white.show()

  const overlay = new BrowserWindow({
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    frame: false, transparent: true, backgroundColor: '#00000000',
    show: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false
  })
  overlay.setContentProtection(true)
  overlay.loadURL('data:text/html,<body style="margin:0"><div style="position:fixed;inset:0;background:rgba(0,0,0,0.34)"></div></body>')
  await new Promise((r) => overlay.once('ready-to-show', r))
  overlay.show()
  overlay.focus()

  // Let DWM settle so both windows are actually composited.
  await new Promise((r) => setTimeout(r, 800))

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1280, height: 720 }
  })
  if (sources.length === 0) {
    console.log('RESULT: no screen sources')
    app.exit(1)
  }
  const bright = meanBrightness(sources[0].thumbnail)

  // Control: capture with protection OFF (second overlay, no dim — but we
  // already have the answer). Just report the protected number.
  console.log(`RESULT: mean brightness of capture with protected dim overlay on white = ${bright}`)
  console.log(bright >= 230 ? 'VERDICT: capture EXCLUDES the overlay — instant-open is safe'
    : bright <= 200 ? 'VERDICT: capture INCLUDES the dim — must hide overlays during capture'
    : 'VERDICT: ambiguous — inspect manually')
  app.exit(0)
})
