/** Shared types used across main, preload and renderer code. */

export interface Hotkeys {
  /** Accelerator, e.g. "Ctrl+Shift+C" */
  circleToSearch: string
  /** Accelerator, e.g. "Alt+Space" */
  holdToGemini: string
}

export interface AppSettings {
  hotkeys: Hotkeys
  launchAtStartup: boolean
}

export type CircleMode = 'lens' | 'attach'

/** How hard the screen-edge glow blooms (Apple-Intelligence-style rim). */
export type GlowIntensity = 'subtle' | 'balanced' | 'vivid'
/** Dim applied OUTSIDE the selection rectangle while dragging. */
export type SelectionDim = 'none' | 'light' | 'classic'

/** Advanced capture/appearance preferences (Settings → Selection & Capture). */
export interface CapturePrefs {
  /** Screen-edge rim glow when Circle to Search wakes. */
  glow: boolean
  glowIntensity: GlowIntensity
  selectionDim: SelectionDim
  /** Also put every crop on the Windows clipboard. */
  copyToClipboard: boolean
  /** Auto-save every crop as PNG into Pictures/Gemini Captures. */
  saveCaptures: boolean
}

export const DEFAULT_PREFS: CapturePrefs = {
  glow: true,
  glowIntensity: 'balanced',
  selectionDim: 'light',
  copyToClipboard: false,
  saveCaptures: false
}

/** Selection rectangle in logical (CSS) pixels, relative to the display. */
export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface Attachment {
  /** PNG data URL of the cropped region */
  dataUrl: string
  source: 'selection'
  createdAt: number
}

export interface CapturePayload {
  /** Fast JPEG preview of the frozen display (the lossless original stays in main). */
  dataUrl: string | null
  scaleFactor: number
  mode: CircleMode
  prefs: CapturePrefs
}

export interface ApiState {
  /** A key is stored locally */
  hasKey: boolean
  /** The key passed validation at least once */
  valid: boolean
  model: string
}

export interface RegistrationStatus {
  circleToSearch: boolean
  holdToGemini: boolean
  settings: boolean
}

export interface SettingsAllResponse {
  version: string
  hotkeys: Hotkeys
  registration: RegistrationStatus
  startup: boolean
  api: ApiState
  theme: 'auto' | 'dark' | 'light'
  orbPosition: 'left' | 'right'
  prefs: CapturePrefs
  isDev: boolean
}

export interface SetHotkeysResponse {
  ok: boolean
  error?: string
  registration?: RegistrationStatus
}

export type GeminiStage = 'working' | 'streaming' | 'done'

export interface GeminiStatusPayload {
  stage: GeminiStage
  detail?: string
}

export interface GeminiChunkPayload {
  /** Text to append; empty string means "replace with full" */
  append: string
  full: string
}

export interface GeminiErrorPayload {
  code: string
  message: string
  needsKey?: boolean
}
