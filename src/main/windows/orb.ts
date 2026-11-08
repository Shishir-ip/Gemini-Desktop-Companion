import { BrowserWindow, ipcMain, screen } from 'electron'
import type { Display, Rectangle } from 'electron'
import path from 'node:path'
import { loadRendererPage } from '../paths'
import { log } from '../logger'
import { store } from '../store'

/**
 * The Gemini orb — a clean, professional notch on the screen edge.
 * Not draggable. Fixed to the left or right screen edge (middle height),
 * as set in Settings. Clicking it reopens the palette with full context.
 */

let orb: BrowserWindow | null = null

const ORB_SIZE = 52

export function getOrbSide(): 'left' | 'right' {
  return (store.get('orbPosition') as 'left' | 'right') ?? 'right'
}

export function setOrbSide(side: 'left' | 'right'): void {
  store.set('orbPosition', side)
  if (orb && !orb.isDestroyed() && orb.isVisible()) {
    const pos = getOrbPosition(displayForBounds(orb.getBounds()))
    orb.setPosition(pos.x, pos.y)
  }
}

function getOrbPosition(display: Display): { x: number; y: number } {
  const side = getOrbSide()
  const wa = display.workArea
  const x = side === 'left' ? wa.x + 6 : wa.x + wa.width - ORB_SIZE - 6
  const y = wa.y + Math.round((wa.height - ORB_SIZE) / 2)
  return { x, y }
}

function cursorDisplay(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

export function getOrbBounds(): Rectangle {
  if (orb && !orb.isDestroyed()) return orb.getBounds()
  const display = cursorDisplay()
  const pos = getOrbPosition(display)
  return { x: pos.x, y: pos.y, width: ORB_SIZE, height: ORB_SIZE }
}

function displayForBounds(b: Rectangle): Display {
  try {
    return screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  } catch {
    return screen.getPrimaryDisplay()
  }
}

/** Show the orb at its fixed edge position with a scale-in animation. */
export function showOrb(_near?: Rectangle): void {
  if (orb && !orb.isDestroyed()) {
    orb.show()
    return
  }
  const display = cursorDisplay()
  const pos = getOrbPosition(display)

  orb = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: ORB_SIZE,
    height: ORB_SIZE,
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
    if (!orb || orb.isDestroyed()) return
    orb.show()
    log('[orb] shown')
  })
}

export function hideOrb(): void {
  if (orb && !orb.isDestroyed()) orb.hide()
}

export function destroyOrb(): void {
  if (orb && !orb.isDestroyed()) orb.destroy()
  orb = null
}
