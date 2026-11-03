import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display } from 'electron'
import { IPC } from '../../shared/ipc'
import type { CircleMode } from '../../shared/types'
import { loadRendererPage, preloadPath } from '../paths'
import { captureAllDisplays, type DisplayCapture } from '../screenshot'
import { setPendingAttachment } from '../attachment'
import { openLensPanel, closeLensPanel } from './lensPanel'
import { showGeminiWidget } from './geminiWidget'

const overlays = new Map<number, BrowserWindow>()
const windowDisplay = new WeakMap<BrowserWindow, number>()
let captures: Map<number, DisplayCapture> = new Map()
let mode: CircleMode = 'lens'
let lensModeActive = false

export function getCircleMode(): CircleMode {
  return mode
}

export function isOverlayOpen(): boolean {
  return overlays.size > 0
}

export function displayIdForWindow(win: BrowserWindow): number | null {
  return windowDisplay.get(win) ?? null
}

/** Freeze every display behind a full-screen selection overlay. */
export async function startCircleToSearch(m: CircleMode = 'lens'): Promise<void> {
  if (overlays.size > 0) return
  mode = m
  lensModeActive = false

  try {
    captures = await captureAllDisplays()
  } catch (err) {
    console.error('[circle] capture failed:', err)
    return
  }
  if (captures.size === 0) {
    console.error('[circle] no displays captured')
    return
  }

  for (const [displayId, capture] of captures) {
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) continue
    createOverlay(display, displayId, capture)
  }

  // Safety net: if ready-to-show never fires (rare), force-show.
  setTimeout(() => {
    for (const win of overlays.values()) {
      if (!win.isDestroyed() && !win.isVisible()) win.show()
    }
  }, 2500)
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
  win.on('closed', () => overlays.delete(displayId))
  loadRendererPage(win, 'circle')
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.show()
    win.focus()
  })
  void capture // used via IPC.CircleGetCapture
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
    setPendingAttachment({ dataUrl, source: 'selection', createdAt: Date.now() })
    closeAllOverlays()
    showGeminiWidget()
    return
  }

  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  lensModeActive = true
  // Dim relaxes to "lens mode": the frozen screen stays visible behind the
  // panel and any click outside the panel dismisses everything.
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.CircleSetLensMode)
  }
  openLensPanel(display, dataUrl)
}

export function isLensModeActive(): boolean {
  return lensModeActive
}

export function closeAllOverlays(): void {
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.destroy()
  }
  overlays.clear()
  lensModeActive = false
}

/** Esc / outside click — close panel + every overlay. */
export function closeAllSearchUI(): void {
  closeLensPanel(true)
  closeAllOverlays()
}

/** Wire overlay-related IPC (called once at startup). */
export function registerOverlayIpc(): void {
  ipcMain.handle(IPC.CircleGetCapture, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return win ? getCaptureForWindow(win) : null
  })
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
