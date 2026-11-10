import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CircleMode } from '../../shared/types'
import { loadRendererPage, preloadPath } from '../paths'
import { captureAllDisplays, type DisplayCapture } from '../screenshot'
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

const READY_WATCHDOG_MS = 7000

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

/** Freeze every display behind a full-screen selection overlay. */
export async function startCircleToSearch(
  m: CircleMode = 'lens',
  opts: { force?: boolean } = {}
): Promise<void> {
  // RE-TRIGGER GUARD: a held key auto-repeats and double-taps land twice —
  // each re-fire used to run a fresh capture WHILE the previous overlay was
  // on screen, so every frozen frame baked the previous dim in (dims
  // compounded → near-black captures → "the subject is too dark").
  // While a session is running, further hotkey presses are ignored.
  if (sessionStarting || sessionActive) {
    if (!opts.force) {
      log('[circle] session already active — ignoring re-trigger')
      return
    }
    // Explicit new intent (e.g. the palette's attach button) replaces the
    // running session instead of being swallowed by it.
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

  // Any floating glass window (palette, settings) sits at the same
  // always-on-top level as the overlay and swallows clicks — including its
  // large invisible interactive cards. Clear the stage first.
  hideGeminiWidget()
  hideSettings()

  // INSTANT OPEN: the overlay windows go up BEFORE the capture finishes.
  // desktopCapturer takes 300-1500ms — awaiting it before showing anything
  // was the "circle to search takes a while to open" bug. The renderer
  // paints a dim-only "Capturing screen…" state; frames are pushed through
  // IPC.CircleSetImage the moment they exist. The overlays are excluded
  // from capture (setContentProtection) so the frozen frames stay clean.
  captures = new Map() // stale frames from a previous session must not leak
  const capturePromise = captureAllDisplays().catch((err) => {
    log(`[circle] capture failed: ${String(err)}`)
    return null as Map<number, DisplayCapture> | null
  })

  for (const display of screen.getAllDisplays()) {
    const existing = overlays.get(display.id)
    if (existing && !existing.isDestroyed()) {
      // Warm reuse: page already loaded — reset to waiting and reshow
      // (no window/page load at all on the fast path).
      readyWindows.add(existing)
      existing.webContents.send(IPC.CircleSetImage, { dataUrl: null, scaleFactor: 1, mode })
      existing.show()
      existing.focus()
      log('[circle] overlay reused (fast path)')
      continue
    }
    createOverlay(display, display.id)
  }
  log(`[circle] overlays shown instantly (mode: ${m}, displays: ${screen.getAllDisplays().length})`)

  const caps = await capturePromise
  // A forced restart (attach button, tray) may have superseded this session
  // while the capture was in flight — its frames are stale, and its failure
  // paths must not close the NEW session's overlays either.
  if (myGen !== sessionGen) {
    log('[circle] capture finished after session was replaced — dropping stale frames')
    return
  }
  if (!caps || caps.size === 0) {
    // Nothing captured — overlays must NOT linger as invisible input blocks.
    log('[circle] no displays captured — closing overlays')
    closeAllSearchUI()
    return
  }
  captures = caps
  for (const [displayId, capture] of caps) {
    const win = overlays.get(displayId)
    if (!win || win.isDestroyed()) continue
    win.webContents.send(IPC.CircleSetImage, {
      dataUrl: capture.dataUrl,
      scaleFactor: capture.scaleFactor,
      mode
    })
  }
  log(`[circle] frozen frames pushed (${caps.size} displays)`)
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
      // The waiting-state repaint runs while the window is hidden (the
      // dismiss-time frame clear) — background throttling would defer it and
      // the stale frozen surface would resurface on the next show.
      backgroundThrottling: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // EXCLUDE FROM CAPTURE: without this, the desktopCapturer grab (which runs
  // while the overlay is already on screen in the instant-open flow) sees the
  // overlay's own dim — the frozen frame captured the selection UI itself and
  // repeated triggers compounded the darkness. WDA_EXCLUDEFROMCAPTURE keeps
  // the overlay visible to the user but invisible to every capture path.
  win.setContentProtection(true)
  windowDisplay.set(win, displayId)
  overlays.set(displayId, win)
  // The frozen frame arrives via IPC.CircleSetImage once captured (or via
  // IPC.CircleGetCapture if the renderer loads after the capture finished).

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
  // Guaranteed Esc kill-switch — handled in the MAIN process, so it works
  // even if the renderer is dead, hung, or blank.
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      closeAllSearchUI()
    }
  })
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.show()
    win.focus()
    win.webContents.invalidate() // defensive repaint nudge for transparent windows
  })
  win.on('closed', () => {
    clearTimeout(watchdog)
    readyWindows.delete(win)
    overlays.delete(displayId)
    // Safety net: if every overlay window dies without a closeAll call
    // (crash path), the session must not stay latched — the hotkey would
    // be dead forever.
    if (overlays.size === 0) sessionActive = false
  })

  loadRendererPage(win, 'circle')
}

/** The renderer asks for its display's frozen frame once loaded. */
export function getCaptureForWindow(win: BrowserWindow): {
  dataUrl: string
  scaleFactor: number
  mode: CircleMode
} | null {
  const displayId = windowDisplay.get(win)
  if (displayId === undefined) return null
  const capture = captures.get(displayId)
  if (!capture) return null
  return { dataUrl: capture.dataUrl, scaleFactor: capture.scaleFactor, mode }
}

/**
 * A crop was completed on `displayId`. Route it to Lens or to the Gemini
 * widget depending on the active mode.
 */
export function handleSelection(dataUrl: string, displayId: number): void {
  if (mode === 'attach') {
    log('[circle] selection captured for Gemini attachment')
    setPendingAttachment({ dataUrl, source: 'selection', createdAt: Date.now() })
    closeAllOverlays()
    showGeminiWidget()
    return
  }

  log('[circle] selection captured — opening results panel')
  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  lensModeActive = true
  // Dim relaxes to "lens mode": the frozen screen stays visible behind the
  // panel and any click outside the panel dismisses everything.
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.CircleSetLensMode)
  }
  openResultsPanel(display, dataUrl)
}

export function isLensModeActive(): boolean {
  return lensModeActive
}

export function closeAllOverlays(): void {
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue
    // Clear the frozen frame BEFORE hiding: Windows keeps presenting a
    // hidden window's last rendered surface, so a warm reopen would flash
    // the previous session's screenshot for the whole capture duration.
    // The renderer swaps to dim-only while the window goes away.
    win.webContents.send(IPC.CircleSetImage, { dataUrl: null, scaleFactor: 1, mode })
    win.hide()
  }
  lensModeActive = false
  sessionActive = false // session over — the hotkey may start a new one
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
  ipcMain.handle(IPC.CircleSelected, (event, dataUrl: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const displayId = win ? displayIdForWindow(win) : null
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      handleSelection(dataUrl, displayId ?? screen.getPrimaryDisplay().id)
    }
  })
  ipcMain.handle(IPC.CircleCancel, () => {
    closeAllSearchUI()
  })
  ipcMain.handle(IPC.CircleDismissAll, () => {
    closeAllSearchUI()
  })
}
