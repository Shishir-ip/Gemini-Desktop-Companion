import { app, globalShortcut, nativeTheme, dialog } from 'electron'
import { applyGoogleFriendlyUserAgents, applyPermissionGuards, getGeminiSession } from './gemini/session'
import { registerIpc } from './ipc'
import { createTray, destroyTray, notifyTray } from './tray'
import { registerAllHotkeys, registrationStatus } from './shortcuts'
import { applyLaunchAtStartup } from './startup'
import { prewarmOverlays, startCircleToSearch } from './windows/overlay'
import { prewarmGeminiWidget, showGeminiWidget } from './windows/geminiWidget'
import { destroyGdiCapture, initGdiCapture } from './gdiCapture'
import { openSettings } from './windows/settingsWindow'
import { openHome } from './windows/homeWindow'
import { store } from './store'
import { initLogger, log } from './logger'

type QuittingProcess = NodeJS.Process & { gdcQuitting?: boolean }

app.setName('Gemini Desktop Companion')

// GPU compositing stays ON. Disabling it (software compositing) is a known
// cause of BLACK transparent windows on Windows and made every overlay
// repaint sluggish — the exact "blackish overlay + slow wake" reports.
// Transparent always-on-top windows render correctly with the GPU path.

// The app is a background tray daemon: launching a second instance simply
// reveals the Home window in the first one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Manual launches (no --hidden) make the app visibly appear — a tray app
  // that "does nothing" on launch reads as broken. Boot launches stay silent.
  const manualLaunch = !process.argv.includes('--hidden')

  app.on('second-instance', () => {
    log('[app] second instance launched — showing home')
    openHome()
  })

  app.whenReady().then(() => {
    initLogger()
    log(`startup args: ${JSON.stringify(process.argv.slice(1))}`)

    nativeTheme.themeSource = 'dark'

    // Chrome-like user agent for the Lens results panel.
    applyGoogleFriendlyUserAgents()
    // No web notifications from the Lens session — results stay in the panel.
    applyPermissionGuards()

    registerIpc()
    createTray()
    registerAllHotkeys()
    // Start the fast-capture runspace ASAP (PowerShell startup is slow).
    initGdiCapture()
    log(
      `hotkeys: circle=${registrationStatus.circleToSearch ? 'ok' : 'CONFLICT'}, ` +
        `gemini=${registrationStatus.holdToGemini ? 'ok' : 'CONFLICT'}, ` +
        `settings=${registrationStatus.settings ? 'ok' : 'CONFLICT'}`
    )

    // Keep the OS login item in sync with the stored preference.
    applyLaunchAtStartup(store.get('launchAtStartup'))

    // INSTANT WAKE: pre-build the hidden overlay + Gemini windows and warm
    // the OS capture pipeline shortly after startup, so the first hotkey
    // press only has to show already-loaded surfaces.
    setTimeout(() => {
      prewarmOverlays()
      prewarmGeminiWidget()
    }, 600)

    // Validate the stored API key in the background (instant first ask).
    setTimeout(() => {
      void getGeminiSession().preload()
    }, 2000)

    // Diagnostic opener: `--gdc-open=<page>` shows a page right after startup
    // (used by scripts/verify-ui.mjs and support).
    const openArg = process.argv.find((a) => a.startsWith('--gdc-open='))
    if (openArg) {
      const page = openArg.split('=')[1] ?? 'home'
      log(`[debug] --gdc-open=${page}`)
      setTimeout(() => {
        if (page === 'circle') void startCircleToSearch('lens', { force: true })
        else if (page === 'widget') showGeminiWidget()
        else if (page === 'settings') openSettings()
        else openHome()
      }, 1500)
    } else if (manualLaunch) {
      // Always land on the Home interface: it explains the features, the
      // shortcuts and the setup status — nothing is hidden in the tray.
      openHome()
      if (!store.get('welcomed')) {
        store.set('welcomed', true)
        notifyTray(
          'Gemini Desktop Companion is running',
          'The Home window explains everything — shortcuts, connecting Gemini, and both features. Find the ✨ sparkle in your tray anytime.'
        )
      }
    }
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
    destroyGdiCapture()
  })

  // Safety: any uncaught exception in the main process should not kill the
  // tray daemon silently — log it and, in packaged builds, tell the user.
  process.on('uncaughtException', (err) => {
    log(`[main] uncaught exception: ${err?.stack ?? String(err)}`)
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
