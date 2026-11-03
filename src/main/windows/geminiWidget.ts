import { BrowserWindow, screen } from 'electron'
import type { Display } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadRendererPage, preloadPath } from '../paths'

let widget: BrowserWindow | null = null

function cursorDisplay(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

/** Show (or focus) the iOS-style floating Gemini command palette. */
export function showGeminiWidget(): void {
  if (widget && !widget.isDestroyed()) {
    widget.show()
    widget.focus()
    // The renderer re-pulls state (attachment, login) when it regains focus.
    return
  }

  const display = cursorDisplay()
  const width = 840
  const height = 600
  const wa = display.workArea
  const x = wa.x + Math.round((wa.width - width) / 2)
  const y = wa.y + wa.height - height - Math.round(wa.height * 0.05)

  widget = new BrowserWindow({
    x,
    y,
    width,
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
  widget.on('closed', () => {
    widget = null
  })
  loadRendererPage(widget, 'gemini')
  widget.once('ready-to-show', () => {
    if (widget && !widget.isDestroyed()) {
      widget.show()
      widget.focus()
    }
  })
}

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
