import { BrowserWindow, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type { CapturePrefs, Hotkeys, SetHotkeysResponse } from '../shared/types'
import { store, getSettings, getPrefs, setPrefs } from './store'
import { registerAllHotkeys, registrationStatus } from './shortcuts'
import { applyLaunchAtStartup, isLaunchAtStartup } from './startup'
import { checkForUpdates } from './updater'
import { openExternalUrl } from './ipcUtils'
import { clearPendingAttachment, getPendingAttachment, setPendingAttachment } from './attachment'
import { getGeminiSession } from './gemini/session'
import {
  closeAllSearchUI,
  isLensModeActive,
  registerOverlayIpc,
  getCircleMode,
  startCircleToSearch
} from './windows/overlay'
import {
  bindPanelIpc,
  retryLensInPanel,
  getLastCrop,
  getPanelWindow
} from './windows/resultsPanel'
import {
  destroyWidget,
  hideGeminiWidget,
  showGeminiWidget,
  minimizeWidget,
  forwardGeminiEvent
} from './windows/geminiWidget'
import { openSettings, pushApiChanged } from './windows/settingsWindow'
import { startVoiceTyping } from './dictation'
import { log } from './logger'

/**
 * Single place where every IPC channel is wired. API client events are
 * bridged to the floating widget and the results panel here as well.
 */
export function registerIpc(): void {
  const gemini = getGeminiSession()

  const forwardEvent = (channel: string, payload: unknown): void => {
    forwardGeminiEvent(channel, payload)
  }

  gemini.on('status', (payload) => forwardEvent(IPC.GeminiStatus, payload))
  gemini.on('chunk', (payload) => forwardEvent(IPC.GeminiChunk, payload))
  gemini.on('done', (payload) => forwardEvent(IPC.GeminiDone, payload))
  gemini.on('error', (payload) => forwardEvent(IPC.GeminiError, payload))

  // ── Circle to Search ─────────────────────────────────────────────────
  registerOverlayIpc()

  // ── Results panel: session-driven Google Lens (reporter's approach) ──
  ipcMain.handle(IPC.ResultsGetCrop, () => getLastCrop())
  ipcMain.handle(IPC.LensOpenWeb, async () => retryLensInPanel())
  bindPanelIpc()
  ipcMain.handle(IPC.WindowClose, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // The results panel is a transient surface: closing it dismisses the
    // whole Circle-to-Search experience (panel + frozen overlays).
    if (win && getPanelWindow() === win) closeAllSearchUI()
    else win?.close()
  })
  ipcMain.handle(IPC.LensCopyImage, () => {
    const crop = getLastCrop()
    if (!crop) return { ok: false }
    try {
      clipboard.writeImage(nativeImage.createFromDataURL(crop))
      return { ok: true }
    } catch (err) {
      log(`[lens] copy failed: ${String(err)}`)
      return { ok: false }
    }
  })
  ipcMain.handle(IPC.LensSaveImage, async () => {
    const crop = getLastCrop()
    if (!crop) return { ok: false }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const opts = {
      title: 'Save capture',
      defaultPath: path.join(app.getPath('pictures'), `Gemini Capture ${stamp}.png`),
      filters: [{ name: 'PNG image', extensions: ['png'] }]
    }
    const parent = getPanelWindow()
    const res = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { ok: false }
    try {
      writeFileSync(res.filePath, Buffer.from(crop.replace(/^data:image\/\w+;base64,/, ''), 'base64'))
      return { ok: true, path: res.filePath }
    } catch (err) {
      log(`[lens] save failed: ${String(err)}`)
      return { ok: false }
    }
  })
  ipcMain.handle(IPC.LensAskGemini, () => {
    const crop = getLastCrop()
    if (!crop) return
    setPendingAttachment({ dataUrl: crop, source: 'selection', createdAt: Date.now() })
    closeAllSearchUI()
    showGeminiWidget()
  })
  ipcMain.handle('gemini:set-model', (_event, model: string) => {
    const error = gemini.setModel(String(model))
    pushApiChanged()
    return { ok: !error, error, state: gemini.getState() }
  })

  // ── Gemini widget ────────────────────────────────────────────────────
  ipcMain.handle(IPC.GeminiGetState, () => ({
    attachment: getPendingAttachment(),
    api: gemini.getState(),
    mode: getCircleMode(),
    chatLog: gemini.getChatLog()
  }))
  ipcMain.handle(IPC.GeminiSubmit, async (_event, text: string) => {
    const prompt = typeof text === 'string' ? text.trim() : ''
    if (!prompt && !getPendingAttachment()) return
    const attachment = getPendingAttachment()
    const imageB64 = attachment
      ? attachment.dataUrl.replace(/^data:image\/\w+;base64,/, '')
      : null
    clearPendingAttachment()
    log(`[gemini] submitting prompt (${prompt.length} chars, image: ${!!imageB64})`)
    try {
      await gemini.submit(prompt || 'Describe this screenshot.', imageB64)
    } catch (err) {
      gemini.emit('error', {
        code: 'SUBMIT_FAILED',
        message: 'Could not reach the Gemini API. Check your connection and try again.'
      })
      console.error('[ipc] submit failed:', err)
    }
  })
  ipcMain.handle(IPC.GeminiAttachFromScreen, () => {
    hideGeminiWidget()
    // force: a deliberate attach click must replace a running search session
    // (the plain hotkey is the one that gets repeat-fire-guarded).
    void startCircleToSearch('attach', { force: true })
  })
  ipcMain.handle(IPC.GeminiRemoveAttachment, () => clearPendingAttachment())
  ipcMain.handle(IPC.GeminiNewChat, () => gemini.resetChat())
  // X = close the chat: DESTROY the window and discard the conversation.
  // Reopening builds a brand-new palette (first-launch state) — no stale
  // window state can persist.
  ipcMain.handle(IPC.GeminiClose, () => {
    destroyWidget()
    gemini.resetChat()
  })
  // Minimize to the Windows taskbar — chat + context persist.
  ipcMain.handle(IPC.GeminiMinimize, () => minimizeWidget())
  // Stop = cancel the in-flight answer (partial text stays).
  ipcMain.handle(IPC.GeminiStop, () => gemini.cancelActive())
  // Mic button → Windows voice typing (Win+H). The renderer focuses the
  // prompt first so dictation lands in it.
  ipcMain.handle(IPC.GeminiDictate, () => startVoiceTyping())

  // ── Settings ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SettingsGetAll, () => ({
    version: app.getVersion(),
    hotkeys: getSettings().hotkeys,
    registration: registrationStatus,
    startup: isLaunchAtStartup(),
    api: gemini.getState(),
    theme: store.get('theme'),
    prefs: getPrefs(),
    isDev: !app.isPackaged
  }))
  ipcMain.handle(IPC.SettingsSetPrefs, (_event, patch: Partial<CapturePrefs>) => {
    const next = setPrefs(patch && typeof patch === 'object' ? patch : {})
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.PrefsChanged, next)
    }
    return next
  })
  ipcMain.handle(
    IPC.SettingsSetHotkeys,
    (_event, hotkeys: Hotkeys): SetHotkeysResponse => {
      const circle = typeof hotkeys?.circleToSearch === 'string' ? hotkeys.circleToSearch.trim() : ''
      const gemini = typeof hotkeys?.holdToGemini === 'string' ? hotkeys.holdToGemini.trim() : ''
      if (!circle || !gemini) {
        return { ok: false, error: 'Both shortcuts are required.' }
      }
      if (circle.toLowerCase() === gemini.toLowerCase()) {
        return { ok: false, error: 'The two shortcuts must be different.' }
      }
      store.set('hotkeys', { circleToSearch: circle, holdToGemini: gemini })
      registerAllHotkeys()
      return { ok: true, registration: { ...registrationStatus } }
    }
  )
  ipcMain.handle(IPC.SettingsSetStartup, (_event, enabled: boolean) => {
    applyLaunchAtStartup(Boolean(enabled))
    return isLaunchAtStartup()
  })
  ipcMain.handle(IPC.SettingsCheckApi, async () => {
    const state = gemini.getState()
    return state
  })
  ipcMain.handle(IPC.SettingsSetApiKey, async (_event, key: string) => {
    const error = await gemini.setApiKey(typeof key === 'string' ? key : '')
    pushApiChanged()
    return { ok: !error, error, state: gemini.getState() }
  })
  ipcMain.handle(IPC.SettingsClearApiKey, () => {
    void gemini.clearApiKey()
    pushApiChanged()
    return gemini.getState()
  })
  ipcMain.handle(IPC.SettingsOpenApiKeys, () => {
    void shell.openExternal('https://aistudio.google.com/apikey')
  })
  ipcMain.handle(IPC.SettingsOpen, () => openSettings())
  ipcMain.handle(IPC.SettingsCheckUpdates, () => checkForUpdates(true))
  ipcMain.handle(IPC.SettingsSetTheme, (_event, theme: string) => {
    const t = ['auto', 'dark', 'light'].includes(theme) ? theme : 'dark'
    store.set('theme', t)
    nativeTheme.themeSource = t === 'auto' ? 'system' : (t as 'dark' | 'light')
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.ThemeChanged, t)
    }
    return t
  })

  // ── Generic window helpers ───────────────────────────────────────────
  ipcMain.handle(IPC.AppOpenExternal, (_event, url: string) => openExternalUrl(url))
  ipcMain.handle(IPC.AppStartCircle, () => void startCircleToSearch('lens', { force: true }))
  ipcMain.handle(IPC.AppShowWidget, () => showGeminiWidget())
  ipcMain.handle(IPC.WindowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  // Outside-click on the frozen screen dismisses the Lens experience.
  ipcMain.handle('circle:outside-click', () => {
    if (isLensModeActive()) closeAllSearchUI()
  })
}
