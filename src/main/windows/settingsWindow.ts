import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { LoginState } from '../../shared/types'
import { loadRendererPage, preloadPath } from '../paths'
import { getGeminiSession } from '../gemini/session'
import { log } from '../logger'
import { forwardGeminiEvent } from './geminiWidget'

let settings: BrowserWindow | null = null

/** Singleton iOS-style settings window (hides on close, keeps state). */
export function openSettings(): void {
  if (settings && !settings.isDestroyed()) {
    settings.show()
    settings.focus()
    return
  }

  settings = new BrowserWindow({
    width: 920,
    height: 700,
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
  settings.setAlwaysOnTop(true, 'screen-saver')
  // Safety: never leave a dead/invisible settings window around.
  settings.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    log(`[settings] load failed (${code} ${desc}) — destroying window`)
    if (settings && !settings.isDestroyed()) settings.destroy()
    settings = null
  })
  settings.webContents.on('render-process-gone', (_event, details) => {
    log(`[settings] renderer gone (${details.reason}) — destroying window`)
    if (settings && !settings.isDestroyed()) settings.destroy()
    settings = null
  })
  settings.on('close', (e) => {
    if (!(process as NodeJS.Process & { gdcQuitting?: boolean }).gdcQuitting) {
      e.preventDefault()
      settings?.hide()
    }
  })
  settings.on('closed', () => {
    settings = null
  })
  loadRendererPage(settings, 'settings')
  settings.once('ready-to-show', () => {
    if (settings && !settings.isDestroyed()) {
      settings.show()
      settings.focus()
    }
  })
}

/** Hide the settings window (used when the selection overlay takes over). */
export function hideSettings(): void {
  if (settings && !settings.isDestroyed()) settings.hide()
}

export function getSettingsWindow(): BrowserWindow | null {
  return settings && !settings.isDestroyed() ? settings : null
}

/** Broadcast a fresh login state to Settings AND the Gemini palette. */
export function pushLoginChanged(): void {
  const state = getGeminiSession().getCachedLoginState()
  const win = getSettingsWindow()
  if (win) {
    win.webContents.send(IPC.LoginChanged, state)
  }
  forwardGeminiEvent(IPC.GeminiLoginChanged, state)
}

/** "Open Gemini history / full session" — reveals the persistent window. */
export async function openGeminiVisible(): Promise<void> {
  await getGeminiSession().openVisible()
}

export type { LoginState }
