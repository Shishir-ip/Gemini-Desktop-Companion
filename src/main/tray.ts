import { Menu, Tray, nativeImage, app } from 'electron'
import { getAssetPath } from './paths'
import { startCircleToSearch } from './windows/overlay'
import { toggleGeminiWidget } from './windows/geminiWidget'
import { openSettings } from './windows/settingsWindow'
import { checkForUpdates } from './updater'

let tray: Tray | null = null

export function createTray(): void {
  const icon = nativeImage.createFromPath(getAssetPath('tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Gemini Desktop Companion')

  const menu = Menu.buildFromTemplate([
    { label: 'Hold to Gemini', click: () => toggleGeminiWidget() },
    { label: 'Circle to Search', click: () => void startCircleToSearch('lens') },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => openSettings() },
    { label: 'Check for Updates…', click: () => void checkForUpdates(true) },
    { type: 'separator' },
    {
      label: 'Quit Gemini Desktop Companion',
      click: () => {
        ;(process as NodeJS.Process & { gdcQuitting?: boolean }).gdcQuitting = true
        app.quit()
      }
    }
  ])

  // Left click toggles the Gemini widget; right click opens the menu.
  tray.on('click', () => toggleGeminiWidget())
  tray.on('right-click', () => tray?.popUpContextMenu(menu))
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
