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
export async function startCircleToSearch(m: CircleMode = 'lens'): Promise<void> {
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
  // IPC.CircleSetImage the moment they exist.
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
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
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
    if (!win.isDestroyed()) win.hide()
  }
  lensModeActive = false
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
