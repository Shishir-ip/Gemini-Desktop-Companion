import { BrowserWindow, clipboard, ipcMain, nativeImage, screen } from 'electron'
import type { Display } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CapturePayload, CircleMode, SelectionRect } from '../../shared/types'
import { loadRendererPage, preloadPath } from '../paths'
import { captureAllDisplays, cropCapture, warmupCapturer, type DisplayCapture } from '../screenshot'
import { gdiAvailable } from '../gdiCapture'
import { getPrefs } from '../store'
import { setPendingAttachment } from '../attachment'
import { openResultsPanel } from './resultsPanel'
import { hideGeminiWidget, showGeminiWidget } from './geminiWidget'
import { hideSettings } from './settingsWindow'
import { log } from '../logger'

const overlays = new Map<number, BrowserWindow>()
const windowDisplay = new WeakMap<BrowserWindow, number>()
/** Windows whose renderer has confirmed it painted and is interactive. */
const readyWindows = new Set<BrowserWindow>()
let captures: Map<number, DisplayCapture> = new Map()
let mode: CircleMode = 'lens'
let lensModeActive = false
/** A startCircleToSearch is in flight (capture pending). */
let sessionStarting = false
/** Overlays are up (selection pending, frozen, or results open). */
let sessionActive = false
/** Monotonic session id — stale async captures must never touch a newer session. */
let sessionGen = 0

const READY_WATCHDOG_MS = 15000

export function getCircleMode(): CircleMode {
  return mode
}

export function displayIdForWindow(win: BrowserWindow): number | null {
  return windowDisplay.get(win) ?? null
}

/** The renderer signals it painted and wired its handlers. */
export function markOverlayReady(sender: Electron.WebContents): void {
  const win = BrowserWindow.fromWebContents(sender)
  if (win) {
    readyWindows.add(win)
    log('[circle] overlay renderer ready')
  }
}

/**
 * Pre-create one hidden overlay per display at startup. The hotkey path then
 * only SHOWS a fully-loaded window — no BrowserWindow construction, no page
 * load, no renderer boot on the critical path. This is what makes the wake
 * feel instant.
 */
export function prewarmOverlays(): void {
  for (const display of screen.getAllDisplays()) {
    if (!overlays.has(display.id)) createOverlay(display, display.id)
  }
  // Warm the slow fallback only if GDI did not come up.
  setTimeout(() => {
    if (!gdiAvailable()) void warmupCapturer()
  }, 4000)
  // Monitor hot-plug / resolution changes: keep one overlay per display.
  screen.on('display-metrics-changed', () => syncOverlaySet())
  screen.on('display-added', () => syncOverlaySet())
  screen.on('display-removed', () => syncOverlaySet())
}

function syncOverlaySet(): void {
  const displays = screen.getAllDisplays()
  const ids = new Set(displays.map((d) => d.id))
  for (const [id, win] of overlays) {
    if (!ids.has(id)) {
      overlays.delete(id)
      readyWindows.delete(win)
      if (!win.isDestroyed()) win.destroy()
    }
  }
  for (const display of displays) {
    const existing = overlays.get(display.id)
    if (existing && !existing.isDestroyed()) {
      // Reposition to the display's (possibly changed) bounds.
      existing.setBounds(display.bounds)
    } else {
      createOverlay(display, display.id)
    }
  }
}

/** Freeze every display behind a full-screen selection overlay. */
export async function startCircleToSearch(
  m: CircleMode = 'lens',
  opts: { force?: boolean } = {}
): Promise<void> {
  // RE-TRIGGER GUARD: a held key auto-repeats and double-taps land twice.
  // While a session is running, further hotkey presses are ignored — this
  // also guarantees only ONE overlay set can ever be on screen.
  if (sessionStarting || sessionActive) {
    if (!opts.force) {
      log('[circle] session already active — ignoring re-trigger')
      return
    }
    closeAllSearchUI()
  }
  sessionStarting = true
  try {
    await runCircleSession(m)
    sessionActive = true
  } finally {
    sessionStarting = false
  }
}

async function runCircleSession(m: CircleMode): Promise<void> {
  const myGen = ++sessionGen
  mode = m
  lensModeActive = false

  // Clear the stage: floating glass windows sit at the same always-on-top
  // level and would swallow clicks.
  hideGeminiWidget()
  hideSettings()

  captures = new Map()
  const prefs = getPrefs()

  // FAST PATH (GDI, ~250ms): capture BEFORE anything is shown. GDI does not
  // honor capture-exclusion, so the frame is guaranteed clean by
  // construction — no overlay, glow or dim can ever be baked in. The wake
  // still feels instant, and the glow animates in over the frozen frame.
  if (gdiAvailable()) {
    const caps = await captureAllDisplays().catch((err) => {
      log(`[circle] capture failed: ${String(err)}`)
      return null as Map<number, DisplayCapture> | null
    })
    if (myGen !== sessionGen) return
    if (caps && caps.size > 0) {
      captures = caps
      for (const display of screen.getAllDisplays()) {
        const win = ensureOverlay(display)
        const capture = caps.get(display.id)
        win.webContents.send(IPC.CircleSetImage, {
          dataUrl: capture?.previewUrl ?? null,
          scaleFactor: display.scaleFactor,
          mode,
          prefs
        } satisfies CapturePayload)
        win.show()
        win.focus()
      }
      log(`[circle] instant wake with frozen frames (mode: ${m}, ${caps.size} display(s))`)
      return
    }
    // GDI produced nothing this time — fall through to the waiting flow.
  }

  // FALLBACK (desktopCapturer, slow on some machines): overlays go up
  // immediately with the rim glow over the LIVE screen; frames are pushed
  // the moment they exist. The overlays are capture-excluded, so frames
  // stay clean on this path.
  const capturePromise = captureAllDisplays().catch((err) => {
    log(`[circle] capture failed: ${String(err)}`)
    return null as Map<number, DisplayCapture> | null
  })
  for (const display of screen.getAllDisplays()) {
    const win = ensureOverlay(display)
    win.webContents.send(IPC.CircleSetImage, {
      dataUrl: null,
      scaleFactor: display.scaleFactor,
      mode,
      prefs
    } satisfies CapturePayload)
    win.show()
    win.focus()
  }
  log(`[circle] overlays shown (waiting flow, mode: ${m})`)

  const caps = await capturePromise
  if (myGen !== sessionGen) {
    log('[circle] capture finished after session was replaced — dropping stale frames')
    return
  }
  if (!caps || caps.size === 0) {
    log('[circle] no displays captured — closing overlays')
    closeAllSearchUI()
    return
  }
  captures = caps
  for (const [displayId, capture] of caps) {
    const win = overlays.get(displayId)
    if (!win || win.isDestroyed()) continue
    win.webContents.send(IPC.CircleSetImage, {
      dataUrl: capture.previewUrl,
      scaleFactor: capture.scaleFactor,
      mode,
      prefs
    } satisfies CapturePayload)
  }
  log(`[circle] frozen frames pushed (${caps.size} displays)`)
}

/** Reuse the pre-warmed overlay for a display, or create it on demand. */
function ensureOverlay(display: Display): BrowserWindow {
  let win = overlays.get(display.id)
  if (!win || win.isDestroyed()) {
    createOverlay(display, display.id)
    win = overlays.get(display.id)!
  }
  win.setBounds(display.bounds)
  return win
}

function createOverlay(display: Display, displayId: number): void {
  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.size.width,
    height: display.size.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: true,
    hasShadow: false,
    enableLargerThanScreen: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The waiting-state repaint runs while the window is hidden —
      // background throttling would defer it and a stale surface could
      // resurface on the next show.
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // EXCLUDE FROM CAPTURE: WDA_EXCLUDEFROMCAPTURE keeps the overlay visible to
  // the user but invisible to every capture path — the frozen frames and all
  // downstream crops stay perfectly clean.
  win.setContentProtection(true)
  windowDisplay.set(win, displayId)
  overlays.set(displayId, win)

  // ── Safety rails: an overlay must NEVER linger as an invisible
  //    input-blocking window. Any failure path destroys it. ────────────────
  const watchdog = setTimeout(() => {
    if (!win.isDestroyed() && !readyWindows.has(win)) {
      log('[circle] watchdog: overlay renderer never became ready — destroying all overlays')
      closeAllSearchUI()
    }
  }, READY_WATCHDOG_MS)

  win.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    log(`[circle] overlay load failed (${code} ${desc}) — destroying all overlays`)
    clearTimeout(watchdog)
    closeAllSearchUI()
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log(`[circle] renderer gone (${details.reason}) — destroying all overlays`)
    clearTimeout(watchdog)
    closeAllSearchUI()
  })
  // Guaranteed Esc kill-switch — handled in MAIN, so it works even if the
  // renderer is dead, hung, or blank.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      closeAllSearchUI()
    }
  })
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    // Pre-warmed windows stay hidden until a session starts; only show here
    // if a session is already waiting for this window.
    if (sessionStarting || sessionActive) {
      win.show()
      win.focus()
    }
    win.webContents.invalidate()
  })
  win.on('closed', () => {
    clearTimeout(watchdog)
    readyWindows.delete(win)
    overlays.delete(displayId)
    if (overlays.size === 0) sessionActive = false
  })

  loadRendererPage(win, 'circle')
}

/** The renderer asks for its display's frozen frame once loaded. */
export function getCaptureForWindow(win: BrowserWindow): CapturePayload | null {
  const displayId = windowDisplay.get(win)
  if (displayId === undefined) return null
  const capture = captures.get(displayId)
  const prefs = getPrefs()
  if (!capture) return { dataUrl: null, scaleFactor: 1, mode, prefs }
  return { dataUrl: capture.previewUrl, scaleFactor: capture.scaleFactor, mode, prefs }
}

/**
 * A selection rect arrived from display `displayId`. Crop the LOSSLESS
 * original in main (never the rendered UI), apply capture preferences, then
 * route to Lens or to the Gemini widget depending on the active mode.
 */
export function handleSelectionRect(rect: SelectionRect, displayId: number): void {
  const capture = captures.get(displayId)
  if (!capture) {
    log('[circle] selection without a capture — ignoring')
    return
  }
  const dataUrl = cropCapture(capture, rect)
  if (!dataUrl) {
    log('[circle] selection too small — ignoring')
    return
  }
  log(`[circle] lossless crop ${Math.round(rect.width)}×${Math.round(rect.height)} (display ${displayId})`)
  applyCapturePrefs(dataUrl)

  if (mode === 'attach') {
    setPendingAttachment({ dataUrl, source: 'selection', createdAt: Date.now() })
    closeAllOverlays()
    showGeminiWidget()
    return
  }

  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  lensModeActive = true
  // The frozen screen relaxes into "lens mode": it stays visible behind the
  // panel and any click outside the panel dismisses everything.
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.CircleSetLensMode)
  }
  openResultsPanel(display, dataUrl)
}

/** Clipboard / auto-save preferences applied to every finished crop. */
function applyCapturePrefs(dataUrl: string): void {
  const prefs = getPrefs()
  if (prefs.copyToClipboard) {
    try {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
    } catch (err) {
      log(`[circle] clipboard copy failed: ${String(err)}`)
    }
  }
  if (prefs.saveCaptures) {
    try {
      const dir = path.join(app.getPath('pictures'), 'Gemini Captures')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const file = path.join(dir, `Capture ${stamp}.png`)
      writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      log(`[circle] capture saved: ${file}`)
    } catch (err) {
      log(`[circle] auto-save failed: ${String(err)}`)
    }
  }
}

export function isLensModeActive(): boolean {
  return lensModeActive
}

export function closeAllOverlays(): void {
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue
    // Clear the frozen frame BEFORE hiding: Windows keeps presenting a
    // hidden window's last rendered surface, so a warm reopen would flash
    // the previous session's screenshot.
    win.webContents.send(IPC.CircleSetImage, {
      dataUrl: null,
      scaleFactor: 1,
      mode,
      prefs: getPrefs()
    } satisfies CapturePayload)
    win.hide()
  }
  lensModeActive = false
  sessionActive = false
}

/** Esc / outside click — close panel + every overlay. */
export function closeAllSearchUI(): void {
  void import('./resultsPanel').then(({ closePanel }) => closePanel(true))
  closeAllOverlays()
}

/** Wire overlay-related IPC (called once at startup). */
export function registerOverlayIpc(): void {
  ipcMain.handle(IPC.CircleGetCapture, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? getCaptureForWindow(win) : null
  })
  ipcMain.on(IPC.CircleReady, (event) => markOverlayReady(event.sender))
  ipcMain.handle(IPC.CircleSelectRect, (event, rect: SelectionRect) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const displayId = win ? displayIdForWindow(win) : null
    if (
      rect &&
      typeof rect.x === 'number' &&
      typeof rect.y === 'number' &&
      typeof rect.width === 'number' &&
      typeof rect.height === 'number'
    ) {
      handleSelectionRect(rect, displayId ?? screen.getPrimaryDisplay().id)
    }
  })
  ipcMain.handle(IPC.CircleCancel, () => {
    closeAllSearchUI()
  })
  ipcMain.handle(IPC.CircleDismissAll, () => {
    closeAllSearchUI()
  })
}