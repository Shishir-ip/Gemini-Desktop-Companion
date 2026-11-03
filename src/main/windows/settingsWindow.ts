import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/ipc'
import type { LoginState } from '../../shared/types'
import { loadRendererPage, preloadPath } from '../paths'
import { getGeminiSession } from '../gemini/session'
import { log } from '../logger'
import { forwardGeminiEvent } from './geminiWidget'
import { notifyTray } from '../tray'

let settings: BrowserWindow | null = null
let login: BrowserWindow | null = null
let loginPoll: NodeJS.Timeout | null = null

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
    // Hide instead of quitting the tray app.
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

/**
 * Google sign-in / Gemini session window. Uses the same `persist:gemini`
 * partition as the hidden session, so cookies carry over — the user only
 * logs in once. A native frame is intentional here: it behaves like the
 * browser users trust for Google authentication. The window closes itself
 * the moment sign-in succeeds.
 */
export async function openLoginWindow(): Promise<void> {
  log('[login] openLoginWindow requested')
  if (login && !login.isDestroyed()) {
    login.show()
    login.focus()
    return
  }

  login = new BrowserWindow({
    width: 520,
    height: 760,
    show: false,
    title: 'Sign in with Google — Gemini Desktop Companion',
    backgroundColor: '#1a1a1e',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:gemini',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  login.on('close', (e) => {
    if (!(process as NodeJS.Process & { gdcQuitting?: boolean }).gdcQuitting) {
      e.preventDefault()
      login?.hide()
    }
  })
  login.on('closed', () => {
    login = null
    stopLoginPoll()
    // Give the session a beat to settle cookies, then refresh status.
    setTimeout(() => {
      void getGeminiSession()
        .refreshLoginState()
        .then(() => pushLoginChanged())
    }, 1200)
  })
  void login.loadURL('https://gemini.google.com/app').catch(() => {})
  login.once('ready-to-show', () => {
    if (login && !login.isDestroyed()) {
      login.show()
      login.focus()
    }
  })

  // While the window is open, watch for a completed sign-in and close it
  // automatically — the user should never have to guess when they're done.
  stopLoginPoll()
  loginPoll = setInterval(() => {
    void (async () => {
      if (!login || login.isDestroyed()) return
      try {
        const state: LoginState = await getGeminiSession().refreshLoginState()
        if (state.loggedIn) {
          log('[login] sign-in detected — closing login window')
          stopLoginPoll()
          if (login && !login.isDestroyed()) login.hide()
          notifyTray('Google account connected', 'Gemini is ready — chats now save to your account history.')
          pushLoginChanged()
        }
      } catch {
        /* page may be mid-navigation */
      }
    })()
  }, 3000)
}

function stopLoginPoll(): void {
  if (loginPoll) {
    clearInterval(loginPoll)
    loginPoll = null
  }
}

export function getLoginWindow(): BrowserWindow | null {
  return login && !login.isDestroyed() ? login : null
}

/** "Open Gemini history / full session" — reveals the persistent window. */
export async function openGeminiVisible(): Promise<void> {
  await getGeminiSession().openVisible()
}
