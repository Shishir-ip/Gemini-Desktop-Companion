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

export interface Attachment {
  /** PNG data URL of the cropped region */
  dataUrl: string
  source: 'selection'
  createdAt: number
}

export interface CapturePayload {
  dataUrl: string
  scaleFactor: number
  mode: CircleMode
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
