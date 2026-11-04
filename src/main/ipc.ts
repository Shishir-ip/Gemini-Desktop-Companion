import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { IPC } from '../shared/ipc'
import type { Hotkeys, SetHotkeysResponse } from '../shared/types'
import { store, getSettings } from './store'
import { registerAllHotkeys, registrationStatus } from './shortcuts'
import { applyLaunchAtStartup, isLaunchAtStartup } from './startup'
import { checkForUpdates } from './updater'
import { openExternalUrl } from './ipcUtils'
import { clearPendingAttachment, getPendingAttachment } from './attachment'
import { getGeminiSession } from './gemini/session'
import {
  closeAllSearchUI,
  isLensModeActive,
  registerOverlayIpc,
  getCircleMode,
  startCircleToSearch,
  markOverlayReady
} from './windows/overlay'
import { retryLensUpload } from './windows/lensPanel'
import {
  hideGeminiWidget,
  showGeminiWidget,
  forwardGeminiEvent,
  setWidgetIgnoreMouse
} from './windows/geminiWidget'
import { openSettings, pushApiChanged } from './windows/settingsWindow'
import { log } from './logger'

/**
 * Single place where every IPC channel is wired. API client events are
 * bridged to the floating widget here as well.
 */
export function registerIpc(): void {
  const gemini = getGeminiSession()

  gemini.on('status', (payload) => forwardGeminiEvent(IPC.GeminiStatus, payload))
  gemini.on('chunk', (payload) => forwardGeminiEvent(IPC.GeminiChunk, payload))
  gemini.on('done', (payload) => forwardGeminiEvent(IPC.GeminiDone, payload))
  gemini.on('error', (payload) => forwardGeminiEvent(IPC.GeminiError, payload))

  // ── Circle to Search ─────────────────────────────────────────────────
  registerOverlayIpc()

  // ── Lens panel ───────────────────────────────────────────────────────
  ipcMain.handle(IPC.LensRetry, async () => retryLensUpload())

  // ── Gemini widget ────────────────────────────────────────────────────
  ipcMain.handle(IPC.GeminiGetState, () => ({
    attachment: getPendingAttachment(),
    api: gemini.getState(),
    mode: getCircleMode()
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
    void startCircleToSearch('attach')
  })
  ipcMain.handle(IPC.GeminiRemoveAttachment, () => clearPendingAttachment())
  ipcMain.handle(IPC.GeminiNewChat, () => gemini.resetChat())
  ipcMain.handle(IPC.GeminiClose, () => hideGeminiWidget())
  ipcMain.handle(IPC.WidgetSetIgnoreMouse, (_event, ignore: boolean) => {
    setWidgetIgnoreMouse(Boolean(ignore))
  })

  // ── Settings ─────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SettingsGetAll, () => ({
    version: app.getVersion(),
    hotkeys: getSettings().hotkeys,
    registration: registrationStatus,
    startup: isLaunchAtStartup(),
    api: gemini.getState(),
    isDev: !app.isPackaged
  }))
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

  // ── Generic window helpers ───────────────────────────────────────────
  ipcMain.handle(IPC.AppOpenExternal, (_event, url: string) => openExternalUrl(url))
  ipcMain.handle(IPC.AppStartCircle, () => void startCircleToSearch('lens'))
  ipcMain.handle(IPC.AppShowWidget, () => showGeminiWidget())
  ipcMain.handle(IPC.WindowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(IPC.WindowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  // Outside-click on the frozen screen dismisses the Lens experience.
  ipcMain.handle('circle:outside-click', () => {
    if (isLensModeActive()) closeAllSearchUI()
  })
}
