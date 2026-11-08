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

  try {
    captures = await captureAllDisplays()
  } catch (err) {
    log(`[circle] capture failed: ${String(err)}`)
    return
  }
  if (captures.size === 0) {
    log('[circle] no displays captured — aborting (no blocker window will be shown)')
    return
  }

  for (const [displayId, capture] of captures) {
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) continue
    const existing = overlays.get(displayId)
    if (existing && !existing.isDestroyed()) {
      // Warm reuse: overlay page is already loaded — push the new frozen
      // frame and reshow. This is the fast path (no page load).
      readyWindows.add(existing)
      existing.webContents.send(IPC.CircleSetImage, {
        dataUrl: capture.dataUrl,
        scaleFactor: capture.scaleFactor,
        mode
      })
      existing.show()
      existing.focus()
      log('[circle] overlay reused (fast path)')
      continue
    }
    createOverlay(display, displayId, capture)
  }
  log(`[circle] overlays created (mode: ${m}, displays: ${captures.size})`)
}

function createOverlay(display: Display, displayId: number, capture: DisplayCapture): void {
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
  void capture // fetched by the renderer via IPC.CircleGetCapture

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
