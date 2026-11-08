import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display, Rectangle } from 'electron'
import path from 'node:path'
import { loadRendererPage } from '../paths'
import { log } from '../logger'

/**
 * The draggable Gemini orb — the palette's minimize target. Click reopens
 * the palette with full context; drag moves it anywhere on screen.
 */

let orb: BrowserWindow | null = null

function cursorDisplay(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

function displayForBounds(b: Rectangle): Display {
  try {
    return screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  } catch {
    return screen.getPrimaryDisplay()
  }
}

function clampToWorkArea(wa: Rectangle, x: number, y: number, w: number, h: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(wa.x, x), wa.x + wa.width - w),
    y: Math.min(Math.max(wa.y, y), wa.y + wa.height - h)
  }
}

// Drag wiring: the orb renderer reports screen-space deltas while dragging.
let last: { x: number; y: number } | null = null
let bound = false
function bindDragIpc(): void {
  if (bound) return
  bound = true
  ipcMain.on('orb:drag-start', (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (w) {
      const b = w.getBounds()
      last = { x: b.x, y: b.y }
    }
  })
  ipcMain.on('orb:drag-move', (event, dx: number, dy: number) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (!w || !last) return
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    try {
      const b = w.getBounds()
      const target = displayForBounds(b)
      const next = clampToWorkArea(target.workArea, b.x + dx, b.y + dy, b.width, b.height)
      w.setPosition(next.x, next.y)
    } catch (err) {
      log(`[orb] drag-move failed: ${String(err)}`)
    }
  })
}

/** Show the orb near the bottom-right of the given rect (or cursor display). */
export function showOrb(near?: Rectangle): void {
  if (orb && !orb.isDestroyed()) {
    orb.show()
    return
  }
  bindDragIpc()
  const display = near
    ? screen.getDisplayNearestPoint({ x: near.x + near.width - 40, y: near.y + near.height - 40 })
    : cursorDisplay()
  const size = 62
  const wa = display.workArea
  const base = near ?? {
    x: wa.x + wa.width - 120,
    y: wa.y + wa.height - 120,
    width: 0,
    height: 0
  }
  const pos = clampToWorkArea(wa, base.x + base.width - size - 8, base.y + base.height - size - 8, size, size)

  orb = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: size,
    height: size,
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
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  orb.setAlwaysOnTop(true, 'screen-saver')
  orb.on('closed', () => {
    orb = null
  })

  loadRendererPage(orb, 'orb')
  orb.once('ready-to-show', () => {
    if (orb && !orb.isDestroyed()) {
      orb.show()
      log('[orb] shown')
    }
  })
}

export function hideOrb(): void {
  if (orb && !orb.isDestroyed()) orb.hide()
}

export function destroyOrb(): void {
  if (orb && !orb.isDestroyed()) orb.destroy()
  orb = null
}
