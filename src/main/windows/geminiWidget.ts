import { BrowserWindow, screen } from 'electron'
import type { Display } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

let widget: BrowserWindow | null = null

const READY_WATCHDOG_MS = 7000

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
  // Start fully click-through: the invisible regions of this window must
  // never swallow desktop clicks. The renderer flips this off whenever the
  // pointer is over a glass card (forward:true keeps hover events flowing).
  widget.setIgnoreMouseEvents(true, { forward: true })

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
      hideGeminiWidget()
    }
  })
  widget.once('ready-to-show', () => {
    if (!widget || widget.isDestroyed()) return
    widget.show()
    widget.focus()
    widget.webContents.invalidate()
  })
  widget.on('closed', () => {
    clearTimeout(watchdog)
    widget = null
  })

  loadRendererPage(widget, 'gemini')
}

function destroyWidget(): void {
  if (widget && !widget.isDestroyed()) widget.destroy()
  widget = null
}

export function hideGeminiWidget(): void {
  if (widget && !widget.isDestroyed()) {
    widget.hide()
    // Reset to click-through so a hidden/shown window never blocks input.
    widget.setIgnoreMouseEvents(true, { forward: true })
  }
}

export function toggleGeminiWidget(): void {
  if (widget && !widget.isDestroyed() && widget.isVisible()) {
    hideGeminiWidget()
  } else {
    showGeminiWidget()
  }
}

/** IPC: the renderer toggles click-through based on pointer position. */
export function setWidgetIgnoreMouse(ignore: boolean): void {
  if (widget && !widget.isDestroyed()) {
    widget.setIgnoreMouseEvents(ignore, { forward: true })
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
