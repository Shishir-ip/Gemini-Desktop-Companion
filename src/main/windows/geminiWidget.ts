import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display, Rectangle } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'
import { showOrb, hideOrb } from './orb'

let widget: BrowserWindow | null = null

const READY_WATCHDOG_MS = 7000
const WIDGET_WIDTH = 720
const MIN_HEIGHT = 190
const MAX_HEIGHT = 640
const BOTTOM_MARGIN = 18

function cursorDisplay(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

/**
 * Show (or focus) the floating Gemini palette.
 *
 * The window is sized to EXACTLY fit the visible cards — there are no
 * invisible interactive regions, so no setIgnoreMouseEvents/click-through
 * machinery is used at all. That mechanism (forward-after-hide/show) was
 * unreliable on Windows and left the palette visible but untouchable.
 * The renderer reports its content height via WidgetResize and this module
 * keeps the window bottom-anchored above the taskbar.
 */
export function showGeminiWidget(): void {
  if (widget && !widget.isDestroyed()) {
    widget.show()
    widget.focus()
    widget.webContents.focus()
    widget.webContents.send(IPC.WidgetShown)
    return
  }

  const display = cursorDisplay()
  const wa = display.workArea
  const height = MIN_HEIGHT
  const x = wa.x + Math.round((wa.width - WIDGET_WIDTH) / 2)
  const y = wa.y + wa.height - height - BOTTOM_MARGIN

  widget = new BrowserWindow({
    x,
    y,
    width: WIDGET_WIDTH,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  widget.setAlwaysOnTop(true, 'screen-saver')

  // ── Safety rails: a failed renderer must never leave an invisible
  //    interactive blocker over the desktop/taskbar. ────────────────────────
  let widgetReady = false
  const watchdog = setTimeout(() => {
    if (widget && !widget.isDestroyed() && !widgetReady) {
      log('[widget] watchdog: renderer never became ready — destroying widget')
      destroyWidget()
    }
  }, READY_WATCHDOG_MS)

  widget.webContents.on('did-finish-load', () => {
    widgetReady = true
    clearTimeout(watchdog)
    log('[widget] renderer loaded')
  })
  widget.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    log(`[widget] load failed (${code} ${desc}) — destroying widget`)
    clearTimeout(watchdog)
    destroyWidget()
  })
  widget.webContents.on('render-process-gone', (_event, details) => {
    log(`[widget] renderer gone (${details.reason}) — destroying widget`)
    clearTimeout(watchdog)
    destroyWidget()
  })
  // Guaranteed Esc — works even with a dead renderer.
  widget.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      hideGeminiWidget({ orb: true })
    }
  })
  widget.once('ready-to-show', () => {
    if (!widget || widget.isDestroyed()) return
    widget.show()
    widget.focus()
    widget.webContents.focus()
    widget.webContents.invalidate()
  })
  widget.on('closed', () => {
    clearTimeout(watchdog)
    widget = null
  })

  loadRendererPage(widget, 'gemini')
}

/** Resize the palette window, keeping its bottom edge anchored. */
export function resizeWidgetTo(height: number): void {
  if (!widget || widget.isDestroyed()) return
  const b = widget.getBounds()
  const display = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  const wa = display.workArea
  const clamped = Math.round(Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT, wa.height - BOTTOM_MARGIN - 8))
  if (clamped === b.height) return
  const nextY = wa.y + wa.height - clamped - BOTTOM_MARGIN
  widget.setBounds({ x: b.x, y: nextY, width: WIDGET_WIDTH, height: clamped })
}

export function destroyWidget(): void {
  if (widget && !widget.isDestroyed()) widget.destroy()
  widget = null
}

/**
 * Hide the palette. `opts.orb` shows the draggable Gemini orb so the user
 * can reopen the conversation (chat + streams continue while hidden).
 */
export function hideGeminiWidget(opts?: { orb?: boolean }): void {
  if (widget && !widget.isDestroyed()) {
    widget.hide()
    if (opts?.orb) showOrb(widget.getBounds())
  }
}

/** Orb click → reopen the palette (context preserved). */
export function openPaletteFromOrb(): void {
  hideOrb()
  showGeminiWidget()
}

export function toggleGeminiWidget(): void {
  if (widget && !widget.isDestroyed() && widget.isVisible()) {
    hideGeminiWidget({ orb: true })
  } else {
    showGeminiWidget()
  }
}

/** IPC: the renderer reports its content height; keep bottom anchored. */
export function bindWidgetResizeIpc(): void {
  ipcMain.on(IPC.WidgetResize, (_event, height: number) => {
    resizeWidgetTo(Number(height))
  })
}

export function isGeminiWidgetVisible(): boolean {
  return !!(widget && !widget.isDestroyed() && widget.isVisible())
}

/** Forward main-process session events into the widget renderer. */
export function forwardGeminiEvent(channel: string, payload: unknown): void {
  if (widget && !widget.isDestroyed()) {
    widget.webContents.send(channel, payload)
  }
}
