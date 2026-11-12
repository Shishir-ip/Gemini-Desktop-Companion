import Store from 'electron-store'
import type { AppSettings, CapturePrefs, Hotkeys } from '../shared/types'
import { DEFAULT_PREFS } from '../shared/types'

/** Type alias (not interface) so it satisfies electron-store's Record constraint. */
export type StoreSchema = {
  hotkeys: Hotkeys
  launchAtStartup: boolean
  welcomed: boolean
  theme: 'auto' | 'dark' | 'light'
  orbPosition: 'left' | 'right'
  prefs: CapturePrefs
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
    theme: 'dark',
    orbPosition: 'right',
    prefs: DEFAULT_PREFS
  }
})

export function getSettings(): AppSettings {
  return {
    hotkeys: store.get('hotkeys'),
    launchAtStartup: store.get('launchAtStartup')
  }
}

/** Stored capture prefs merged over defaults (survives schema growth). */
export function getPrefs(): CapturePrefs {
  return { ...DEFAULT_PREFS, ...store.get('prefs') }
}

/** Validate + merge a partial prefs update; returns the new full prefs. */
export function setPrefs(patch: Partial<CapturePrefs>): CapturePrefs {
  const next = getPrefs()
  if (typeof patch.glow === 'boolean') next.glow = patch.glow
  if (patch.glowIntensity === 'subtle' || patch.glowIntensity === 'balanced' || patch.glowIntensity === 'vivid') {
    next.glowIntensity = patch.glowIntensity
  }
  if (patch.selectionDim === 'none' || patch.selectionDim === 'light' || patch.selectionDim === 'classic') {
    next.selectionDim = patch.selectionDim
  }
  if (typeof patch.copyToClipboard === 'boolean') next.copyToClipboard = patch.copyToClipboard
  if (typeof patch.saveCaptures === 'boolean') next.saveCaptures = patch.saveCaptures
  store.set('prefs', next)
  return next
}
