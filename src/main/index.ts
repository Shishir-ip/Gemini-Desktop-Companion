import { app, globalShortcut, nativeTheme, dialog } from 'electron'
import { applyGoogleFriendlyUserAgents, applyPermissionGuards, getGeminiSession } from './gemini/session'
import { registerIpc } from './ipc'
import { createTray, destroyTray, notifyTray } from './tray'
import { registerAllHotkeys, registrationStatus } from './shortcuts'
import { applyLaunchAtStartup } from './startup'
import { startCircleToSearch } from './windows/overlay'
import { showGeminiWidget } from './windows/geminiWidget'
import { openSettings, openLoginWindow } from './windows/settingsWindow'
import { store } from './store'
import { initLogger, log } from './logger'

type QuittingProcess = NodeJS.Process & { gdcQuitting?: boolean }

app.setName('Gemini Desktop Companion')

// Transparent always-on-top overlay windows are the core of this app.
// Software compositing is dramatically more reliable for them across GPU
// drivers (blank/invisible window reports are always GPU-compositing bugs).
app.disableHardwareAcceleration()

// The app is a background tray daemon: launching a second instance simply
// reveals the Gemini widget in the first one.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Manual launches (no --hidden) make the app visibly appear — a tray app
  // that "does nothing" on launch reads as broken. Boot launches stay silent.
  const manualLaunch = !process.argv.includes('--hidden')

  app.on('second-instance', () => {
    log('[app] second instance launched — showing widget')
    showGeminiWidget()
  })

  app.whenReady().then(() => {
    initLogger()
    log(`startup args: ${JSON.stringify(process.argv.slice(1))}`)

    nativeTheme.themeSource = 'dark'

    // Chrome-like user agent so Google serves full pages (login + Gemini).
    applyGoogleFriendlyUserAgents()
    // No web notifications from the hidden Gemini/Lens sessions — responses
    // must stream into the palette, never leak as Windows toasts.
    applyPermissionGuards()

    registerIpc()
    createTray()
    registerAllHotkeys()
    log(
      `hotkeys: circle=${registrationStatus.circleToSearch ? 'ok' : 'CONFLICT'}, ` +
        `gemini=${registrationStatus.holdToGemini ? 'ok' : 'CONFLICT'}, ` +
        `settings=${registrationStatus.settings ? 'ok' : 'CONFLICT'}`
    )

    // Keep the OS login item in sync with the stored preference.
    applyLaunchAtStartup(store.get('launchAtStartup'))

    // Warm up the hidden Gemini session so the first Hold-to-Gemini is instant.
    setTimeout(() => {
      void getGeminiSession().preload()
    }, 3000)

    // Diagnostic opener: `--gdc-open=circle|widget|settings` shows a page
    // right after startup (used by scripts/verify-ui.mjs and support).
    const openArg = process.argv.find((a) => a.startsWith('--gdc-open='))
    if (openArg) {
      const page = openArg.split('=')[1] ?? 'widget'
      log(`[debug] --gdc-open=${page}`)
      setTimeout(() => {
        if (page === 'circle') void startCircleToSearch('lens')
        else if (page === 'settings') openSettings()
        else showGeminiWidget()
      }, 1500)
    } else if (manualLaunch) {
      const firstRun = !store.get('welcomed')
      showGeminiWidget()
      if (firstRun) {
        // First launch: surface the actual UI — settings with the account
        // card is the natural "home screen" for a tray app like this.
        store.set('welcomed', true)
        const hk = store.get('hotkeys').holdToGemini
        notifyTray(
          'Gemini Desktop Companion is running',
          `Look for the ✨ sparkle in your system tray (check the ^ overflow). ` +
            `Press ${hk} anywhere to ask Gemini, ${store.get('hotkeys').circleToSearch} for Circle to Search.`
        )
        setTimeout(() => openSettings(), 400)
      } else if (!process.argv.includes('--gdc-open=')) {
        // Returning user: if they're signed out, bring the sign-in window up
        // front — signed-out Gemini is rate-limited and saves no history.
        setTimeout(() => {
          void (async () => {
            const state = await getGeminiSession().refreshLoginState()
            if (!state.loggedIn && !state.unknown) {
              log('[app] signed out on launch — opening sign-in window')
              await openLoginWindow()
            }
          })()
        }, 6000)
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
