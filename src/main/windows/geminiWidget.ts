import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

let widget: BrowserWindow | null = null
let resizeIpcBound = false

const READY_WATCHDOG_MS = 7000
const WIDGET_WIDTH = 720
const PILL_HEIGHT = 92
const BOTTOM_MARGIN = 48

function cursorDisplay(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

/** Bottom-center anchor, Android-style: the palette grows UPWARD. */
function anchoredBounds(display: Display, height: number): Electron.Rectangle {
  const wa = display.workArea
  return {
    x: wa.x + Math.round((wa.width - WIDGET_WIDTH) / 2),
    y: wa.y + wa.height - height - BOTTOM_MARGIN,
    width: WIDGET_WIDTH,
    height
  }
}

/**
 * Pre-create the (hidden) Gemini pill at startup so Alt+Space only has to
 * show a fully-loaded window — instant wake, every time.
 */
export function prewarmGeminiWidget(): void {
  if (!widget || widget.isDestroyed()) buildWidget()
}

/**
 * Show (or focus) the floating Gemini pill, anchored a comfortable margin
 * above the bottom edge. The pill pops up with a spring animation.
 */
export function showGeminiWidget(): void {
  if (!widget || widget.isDestroyed()) buildWidget()
  if (!widget) return
  const display = cursorDisplay()
  const height = widget.getBounds().height || PILL_HEIGHT
  widget.setBounds(anchoredBounds(display, height))
  widget.show()
  widget.focus()
  widget.webContents.focus()
  widget.webContents.send(IPC.WidgetShown)
}

function buildWidget(): void {
  // Self-sizing: the renderer reports its content height; the window hugs
  // the pill/chat and stays anchored to the bottom edge as it grows.
  if (!resizeIpcBound) {
    resizeIpcBound = true
    ipcMain.on(IPC.WidgetResize, (event, height: number) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed() || win !== widget) return
      if (typeof height !== 'number' || !Number.isFinite(height)) return
      const display = screen.getDisplayMatching(win.getBounds())
      const maxH = Math.max(220, display.workArea.height - 48)
      const h = Math.max(70, Math.min(maxH, Math.round(height)))
      const b = win.getBounds()
      if (b.height !== h) win.setBounds(anchoredBounds(display, h))
    })
  }

  const display = cursorDisplay()

  widget = new BrowserWindow({
    ...anchoredBounds(display, PILL_HEIGHT),
    show: false,
    frame: false,
    // The window alpha is only the pill's rounded silhouette — every
    // surface inside is fully solid (no frosted glass anywhere).
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    title: 'Gemini',
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
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

/** Hide the palette (chat context persists — the hotkey restores it). */
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