import { globalShortcut } from 'electron'
import { getSettings } from './store'
import { startCircleToSearch } from './windows/overlay'
import { toggleGeminiWidget } from './windows/geminiWidget'
import { openSettings } from './windows/settingsWindow'
import type { RegistrationStatus } from '../shared/types'

/** Registration outcome per feature, surfaced in Settings. */
export const registrationStatus: RegistrationStatus = {
  circleToSearch: false,
  holdToGemini: false,
  settings: false
}

/** (Re)register every global shortcut from user preferences. */
export function registerAllHotkeys(): void {
  globalShortcut.unregisterAll()

  const { hotkeys } = getSettings()
  registrationStatus.circleToSearch = safeRegister(hotkeys.circleToSearch, () => {
    void startCircleToSearch('lens')
  })
  registrationStatus.holdToGemini = safeRegister(hotkeys.holdToGemini, () => {
    toggleGeminiWidget()
  })
  // Fixed global shortcut for Settings (as documented in the README).
  registrationStatus.settings = safeRegister('Control+,', () => {
    openSettings()
  })
}

function safeRegister(accelerator: string, handler: () => void): boolean {
  if (!accelerator) return false
  try {
    return globalShortcut.register(accelerator, handler)
  } catch (err) {
    console.error(`[shortcuts] failed to register "${accelerator}":`, err)
    return false
  }
}
