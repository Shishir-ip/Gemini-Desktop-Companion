import { app, globalShortcut, nativeTheme, session as electronSession, dialog } from 'electron'
import { applyGoogleFriendlyUserAgents, getGeminiSession } from './gemini/session'
import { registerIpc } from './ipc'
import { createTray, destroyTray } from './tray'
import { registerAllHotkeys } from './shortcuts'
import { applyLaunchAtStartup } from './startup'
import { closeAllOverlays, closeAllSearchUI } from './windows/overlay'
import { hideGeminiWidget, showGeminiWidget } from './windows/geminiWidget'
import { store } from './store'

type QuittingProcess = NodeJS.Process & { gdcQuitting?: boolean }

app.setName('Gemini Desktop Companion')

// The app is a background tray daemon: launching a second instance simply
// reveals the Gemini widget in the first one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showGeminiWidget()
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark'

    // Chrome-like user agent so Google serves full pages (login + Gemini).
    applyGoogleFriendlyUserAgents()

    registerIpc()
    createTray()
    registerAllHotkeys()

    // Keep the OS login item in sync with the stored preference.
    applyLaunchAtStartup(store.get('launchAtStartup'))

    // Warm up the hidden Gemini session so the first Hold-to-Gemini is instant.
    setTimeout(() => {
      void getGeminiSession().preload()
    }, 3000)
  })

  app.on('window-all-closed', () => {
    // Tray app: only quit when the user explicitly asked for it.
    if ((process as QuittingProcess).gdcQuitting) app.quit()
  })

  app.on('before-quit', () => {
    ;(process as QuittingProcess).gdcQuitting = true
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    destroyTray()
  })

  // Safety: any uncaught exception in the main process should not kill the
  // tray daemon silently — log it and, in packaged builds, tell the user.
  process.on('uncaughtException', (err) => {
    console.error('[main] uncaught exception:', err)
    if (app.isPackaged) {
      dialog
        .showMessageBox({
          type: 'error',
          title: 'Gemini Desktop Companion',
          message: 'Something went wrong.',
          detail: String(err?.message ?? err),
          buttons: ['OK']
        })
        .catch(() => {})
    }
  })
}

// Referenced so bundlers keep these side-effectful modules first.
void closeAllSearchUI
void closeAllOverlays
void hideGeminiWidget
void electronSession
