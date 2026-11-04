import { session as electronSession } from 'electron'
import { GeminiApiClient, getGeminiApi } from './api'
import { chromeUserAgent } from '../paths'

/**
 * Compatibility shim: the "session" is now the official-API client.
 * The old approach (driving gemini.google.com's DOM from a hidden window)
 * depended on Google's anti-automation mood, page structure, IP reputation
 * and a system proxy — none controllable, none reliable. The API client is
 * deterministic: documented REST endpoint, true SSE streaming, native image
 * input, honest errors.
 */
export type GeminiSession = GeminiApiClient

export function getGeminiSession(): GeminiApiClient {
  return getGeminiApi()
}

/** Apply the Chrome-like user agent to Google-facing sessions (Lens panel). */
export function applyGoogleFriendlyUserAgents(): void {
  const ua = chromeUserAgent()
  electronSession.defaultSession.setUserAgent(ua)
  electronSession.fromPartition('persist:lens').setUserAgent(ua)
}

/**
 * Deny permission requests (notifications, geolocation, …) on Google-facing
 * sessions — the Lens page must never spawn Windows toasts.
 */
export function applyPermissionGuards(): void {
  const ses = electronSession.fromPartition('persist:lens')
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
}
