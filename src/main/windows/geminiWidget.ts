import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display, Rectangle } from 'electron'
import { IPC } from '../../shared/ipc'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'
import { showOrb, hideOrb, getOrbBounds } from './orb'
import { animateWindowBounds } from '../animate'

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
 * SOLID window (no transparency, no click-through machinery) at a fixed
 * 720×480 — fully interactive the moment it opens, every time. Messages
 * scroll inside; an empty state shows when there's no chat yet.
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
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    roundedCorners: true,
    backgroundColor: '#1c1c22',
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

/**
 * Orb click → animate the orb expanding toward the palette position,
 * then hide the orb and show the palette with full context.
 */
export function openPaletteFromOrb(): void {
  if (!widget || widget.isDestroyed()) {
    hideOrb()
    showGeminiWidget()
    return
  }
  // Animate the orb moving to the palette's position, then swap.
  const orbBounds = hideOrbAndGetBounds()
  if (orbBounds) {
    const target = {
      x: orbBounds.x + orbBounds.width / 2 - widget.getBounds().width / 2,
      y: Math.max(0, orbBounds.y - 100)
    }
    // Animate the palette appearing from the orb position.
    const current = widget.getBounds()
    widget.setBounds({ ...current, x: target.x, y: target.y })
    widget.show()
    animateWindowBounds(widget, { ...current, x: target.x, y: target.y }, current, 250)
  } else {
    widget.show()
  }
  widget.focus()
  widget.webContents.focus()
  log('[widget] reopened from orb')
}

function hideOrbAndGetBounds(): Rectangle | null {
  // We need the orb bounds before hiding it.
  const { getOrbBounds } = require('./orb') as typeof import('./orb')
  const bounds = getOrbBounds()
  hideOrb()
  return bounds
}

export function toggleGeminiWidget(): void {
  if (widget && !widget.isDestroyed() && widget.isVisible()) {
    hideGeminiWidget({ orb: true })
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
