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
import {
  getLastCrop,
  closePanel,
  forwardResultsEvent,
  getPanelWindow
} from './windows/resultsPanel'
import {
  hideGeminiWidget,
  showGeminiWidget,
  forwardGeminiEvent,
  setWidgetIgnoreMouse,
  openPaletteFromOrb
} from './windows/geminiWidget'
import { openSettings, pushApiChanged } from './windows/settingsWindow'
import { log } from './logger'

/**
 * Single place where every IPC channel is wired. API client events are
 * bridged to the floating widget and the results panel here as well.
 */
export function registerIpc(): void {
  const gemini = getGeminiSession()

  const forwardEvent = (channel: string, payload: unknown): void => {
    forwardGeminiEvent(channel, payload)
    forwardResultsEvent(channel, payload)
  }

  gemini.on('status', (payload) => forwardEvent(IPC.GeminiStatus, payload))
  gemini.on('chunk', (payload) => forwardEvent(IPC.GeminiChunk, payload))
  gemini.on('done', (payload) => forwardEvent(IPC.GeminiDone, payload))
  gemini.on('error', (payload) => forwardEvent(IPC.GeminiError, payload))

  // ── Circle to Search ─────────────────────────────────────────────────
  registerOverlayIpc()

  // ── Results panel (Gemini vision + Lens fallback) ────────────────────
  ipcMain.handle(IPC.ResultsGetCrop, () => getLastCrop())
  ipcMain.handle(IPC.ResultsAnalyze, async () => {
    const crop = getLastCrop()
    if (!crop) return
    const imageB64 = crop.replace(/^data:image\/\w+;base64,/, '')
    await gemini.submitVision(
      'You are Circle to Search. Analyze this screenshot region: transcribe any text exactly, identify objects, products, people, landmarks, apps, errors or code you see, then give a concise, useful summary in 2-5 short bullets. If it shows a question or an error message, answer or fix it. Stay under 180 words.',
      imageB64
    )
  })
  ipcMain.handle(IPC.WindowClose, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    // The results panel is a transient surface: close destroys it.
    if (win && getPanelWindow() === win) closePanel(true)
    else win?.close()
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
  ipcMain.handle(IPC.GeminiClose, () => hideGeminiWidget({ orb: true }))
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
  ipcMain.handle(IPC.OrbOpen, () => openPaletteFromOrb())
  ipcMain.handle(IPC.WindowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  // Outside-click on the frozen screen dismisses the Lens experience.
  ipcMain.handle('circle:outside-click', () => {
    if (isLensModeActive()) closeAllSearchUI()
  })
}
