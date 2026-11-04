import { BrowserWindow } from 'electron'
import type { Display, Rectangle } from 'electron'
import path from 'node:path'
import { searchLens } from '../gemini/lens'
import { shell } from 'electron'
import { animateWindowBounds } from '../animate'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

let panel: BrowserWindow | null = null
let lastCrop: string | null = null

/**
 * Circle-to-Search results panel. Shows the crop, streams a Gemini vision
 * analysis (the reliable API path), and offers "Open in Google Lens" as the
 * classic fallback.
 */
export function openResultsPanel(display: Display, dataUrl: string): void {
  closePanel(true)
  lastCrop = dataUrl

  const wa = display.workArea
  const margin = 12
  const width = 500
  const height = wa.height - margin * 2
  const target: Rectangle = {
    x: wa.x + wa.width - width - margin,
    y: wa.y + margin,
    width,
    height
  }
  const start: Rectangle = { ...target, x: display.bounds.x + display.bounds.width + 60 }

  panel = new BrowserWindow({
    ...start,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#101014',
    roundedCorners: true,
    webPreferences: {
      preload: preloadPath('index'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  panel.setAlwaysOnTop(true, 'screen-saver')
  panel.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
    }
  })
  panel.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    log(`[results] panel load failed (${code} ${desc}) — closing search UI`)
    void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
  })
  panel.webContents.on('render-process-gone', (_event, details) => {
    log(`[results] panel renderer gone (${details.reason}) — closing search UI`)
    void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
  })
  panel.on('closed', () => {
    panel = null
  })

  loadRendererPage(panel, 'results')
  panel.once('ready-to-show', () => {
    if (!panel || panel.isDestroyed()) return
    panel.show()
    animateWindowBounds(panel, start, target, 240)
  })
}

/**
 * Open the Google Lens results for the stored crop in the USER'S DEFAULT
 * BROWSER — the embedded panel gets served an empty shell by Google's bot
 * detection, while the real browser always returns full results.
 */
export async function openLensInBrowser(): Promise<boolean> {
  if (!lastCrop) return false
  const result = await searchLens(lastCrop)
  if (!result.ok) return false
  await shell.openExternal(result.url)
  log('[results] Lens results opened in default browser')
  return true
}

export function getLastCrop(): string | null {
  return lastCrop
}

export function closePanel(immediate = false): void {
  if (!panel) return
  const p = panel
  panel = null
  if (immediate || p.isDestroyed()) {
    if (!p.isDestroyed()) p.destroy()
    return
  }
  const bounds = p.getBounds()
  animateWindowBounds(p, bounds, { ...bounds, x: bounds.x + bounds.width + 80 }, 180)
  setTimeout(() => {
    if (!p.isDestroyed()) p.destroy()
  }, 200)
}

export function hasResultsPanel(): boolean {
  return panel !== null && !panel!.isDestroyed()
}

export function getPanelWindow(): BrowserWindow | null {
  return panel && !panel.isDestroyed() ? panel : null
}

/** Forward API streaming events into the results panel (if open). */
export function forwardResultsEvent(channel: string, payload: unknown): void {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send(channel, payload)
  }
}


