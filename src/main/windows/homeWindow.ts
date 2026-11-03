import { BrowserWindow, screen } from 'electron'
import type { Display } from 'electron'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

let home: BrowserWindow | null = null

function cursorDisplay(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

/**
 * The main interface: explains the app, its shortcuts and the account
 * status. Shown on launch and when the tray icon is clicked.
 */
export function openHome(): void {
  if (home && !home.isDestroyed()) {
    home.show()
    home.focus()
    return
  }

  const display = cursorDisplay()
  const width = 1020
  const height = 740
  const wa = display.workArea
  const x = wa.x + Math.round((wa.width - width) / 2)
  const y = wa.y + Math.max(8, Math.round((wa.height - height) / 2) - 20)

  home = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
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
  home.setAlwaysOnTop(true, 'screen-saver')

  home.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    log(`[home] load failed (${code} ${desc}) — destroying window`)
    if (home && !home.isDestroyed()) home.destroy()
    home = null
  })
  home.webContents.on('render-process-gone', (_event, details) => {
    log(`[home] renderer gone (${details.reason}) — destroying window`)
    if (home && !home.isDestroyed()) home.destroy()
    home = null
  })
  // Esc closes the home window.
  home.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') hideHome()
  })
  home.on('closed', () => {
    home = null
  })

  loadRendererPage(home, 'home')
  home.once('ready-to-show', () => {
    if (home && !home.isDestroyed()) {
      home.show()
      home.focus()
      home.webContents.invalidate()
    }
  })
}

export function hideHome(): void {
  if (home && !home.isDestroyed()) home.hide()
}

export function isHomeVisible(): boolean {
  return !!(home && !home.isDestroyed() && home.isVisible())
}

/** Notify the home renderer that state (login, etc.) changed. */
export function refreshHomeState(): void {
  if (home && !home.isDestroyed()) {
    home.webContents.send('home:refresh')
  }
}
