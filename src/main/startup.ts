import { app } from 'electron'
import { store } from './store'

/**
 * Sync the Windows login item with the stored preference.
 * Registration only applies to packaged builds — in development the
 * electron.exe binary would otherwise be registered to run at boot.
 */
export function applyLaunchAtStartup(enabled: boolean): void {
  store.set('launchAtStartup', enabled)
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: ['--hidden']
    })
  }
}

export function isLaunchAtStartup(): boolean {
  if (app.isPackaged) {
    return app.getLoginItemSettings().openAtLogin
  }
  return store.get('launchAtStartup')
}
