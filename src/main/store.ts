import Store from 'electron-store'
import type { AppSettings, Hotkeys } from '../shared/types'

/** Type alias (not interface) so it satisfies electron-store's Record constraint. */
export type StoreSchema = {
  hotkeys: Hotkeys
  launchAtStartup: boolean
  welcomed: boolean
  theme: 'auto' | 'dark' | 'light'
  /** safeStorage-encrypted Gemini API key (base64) */
  apiKeyEnc?: string
  apiModel?: string
}

export const DEFAULT_HOTKEYS: Hotkeys = {
  circleToSearch: 'Ctrl+Shift+C',
  holdToGemini: 'Alt+Space'
}

export const store = new Store<StoreSchema>({
  defaults: {
    hotkeys: DEFAULT_HOTKEYS,
    launchAtStartup: true,
    welcomed: false,
    theme: 'dark'
  }
})

export function getSettings(): AppSettings {
  return {
    hotkeys: store.get('hotkeys'),
    launchAtStartup: store.get('launchAtStartup')
  }
}
