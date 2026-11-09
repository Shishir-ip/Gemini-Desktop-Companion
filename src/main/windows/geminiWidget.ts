import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

let widget: BrowserWindow | null = null

const READY_WATCHDOG_MS = 7000
const WIDGET_WIDTH = 720
const WIDGET_HEIGHT = 480

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
 * SOLID window (no transparency) at 720×480 — shows in the taskbar,
 * can be minimized, fully interactive every time it opens.
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
  const x = wa.x + Math.round((wa.width - WIDGET_WIDTH) / 2)
  const y = wa.y + Math.max(20, Math.round((wa.height - WIDGET_HEIGHT) / 2) - 20)

  widget = new BrowserWindow({
    x,
    y,
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    show: false,
    frame: false,
    transparent: false,
    resizable: false,
    movable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    roundedCorners: true,
    backgroundColor: '#1c1c22',
    title: 'Gemini',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  widget.setAlwaysOnTop(true, 'screen-saver')

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
  widget.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      hideGeminiWidget()
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

export function destroyWidget(): void {
  if (widget && !widget.isDestroyed()) widget.destroy()
  widget = null
}

/** Minimize to the Windows taskbar — chat and context persist. */
export function minimizeWidget(): void {
  if (widget && !widget.isDestroyed()) widget.minimize()
}

/** Hide the palette (chat context persists — clicking the taskbar restores). */
export function hideGeminiWidget(): void {
  if (widget && !widget.isDestroyed()) widget.hide()
}

export function toggleGeminiWidget(): void {
  if (widget && !widget.isDestroyed() && widget.isVisible()) {
    hideGeminiWidget()
  } else {
    showGeminiWidget()
  }
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
