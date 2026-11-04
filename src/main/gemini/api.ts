import { safeStorage } from 'electron'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { store } from '../store'
import { log } from '../logger'

/**
 * Gemini via the OFFICIAL API (Google AI Studio key) — the reliable path.
 *
 * Why this replaced web scraping: driving gemini.google.com's DOM depends on
 * Google's anti-automation mood, page structure, IP reputation and a system
 * proxy — none of which we control. The API is a documented REST endpoint:
 * direct node:https connections (no proxy interference), true streaming via
 * SSE, native image input, and honest errors instead of infinite spinners.
 *
 * Users create a free key at https://aistudio.google.com/apikey (30 seconds
 * in their normal browser) and paste it once. The key is encrypted at rest
 * with Electron safeStorage (DPAPI on Windows).
 */

const API_HOST = 'generativelanguage.googleapis.com'
const DEFAULT_MODEL = 'gemini-2.5-flash'
const MAX_HISTORY_ENTRIES = 20

export interface ApiState {
  hasKey: boolean
  valid: boolean
  model: string
}

interface ChatPart {
  text?: string
  inline_data?: { mime_type: string; data: string }
}

interface ChatContent {
  role: 'user' | 'model'
  parts: ChatPart[]
}

export class GeminiApiClient extends EventEmitter {
  private apiKey = ''
  private keyValid = false
  private model = DEFAULT_MODEL
  private history: ChatContent[] = []
  private active = false

  constructor() {
    super()
    this.loadKey()
  }

  /** Decrypt the stored key (safeStorage/DPAPI; plaintext fallback). */
  private loadKey(): void {
    try {
      const stored = store.get('apiKeyEnc') as string | undefined
      if (!stored) return
      if (safeStorage.isEncryptionAvailable()) {
        this.apiKey = safeStorage.decryptString(Buffer.from(stored, 'base64'))
      } else {
        this.apiKey = Buffer.from(stored, 'base64').toString('utf8')
      }
      this.keyValid = true // assumed; re-validated on first request
      this.model = (store.get('apiModel') as string | undefined) ?? DEFAULT_MODEL
    } catch (err) {
      log(`[api] failed to load stored key: ${String(err)}`)
      this.apiKey = ''
      this.keyValid = false
    }
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0
  }

  /** Store (encrypt) and validate a new key. Returns an error message or null. */
  async setApiKey(rawKey: string): Promise<string | null> {
    const key = rawKey.trim()
    if (!key) return 'Please paste a key first.'
    this.apiKey = key
    const err = await this.validateKey()
    if (err) {
      this.apiKey = ''
      return err
    }
    this.keyValid = true
    try {
      const payload = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(key).toString('base64')
        : Buffer.from(key, 'utf8').toString('base64')
      store.set('apiKeyEnc', payload)
      store.set('apiModel', this.model)
    } catch (err) {
      log(`[api] failed to persist key: ${String(err)}`)
    }
    log('[api] Gemini API key saved and validated')
    return null
  }

  async clearApiKey(): Promise<void> {
    this.apiKey = ''
    this.keyValid = false
    this.history = []
    store.delete('apiKeyEnc')
  }

  getState(): ApiState {
    return { hasKey: this.hasApiKey(), valid: this.keyValid, model: this.model }
  }

  /** Quick models.list call — proves the key works. */
  async validateKey(): Promise<string | null> {
    try {
      const status = await this.rawRequest(
        'GET',
        `/v1beta/models?key=${encodeURIComponent(this.apiKey)}`,
        null
      )
      if (status === 200) return null
      if (status === 400 || status === 403) return 'That key was rejected by Google. Double-check it (a full AI Studio key starts with "AIza").'
      if (status === 429) return 'Rate limited by Google — try again in a minute.'
      return `Google answered ${status}. Check the key and your connection.`
    } catch (err) {
      return `Could not reach Google's API: ${String((err as Error)?.message ?? err)}`
    }
  }

  resetChat(): void {
    this.history = []
    log('[api] conversation reset')
  }

  /** Warm-up: validate the stored key (no-op when absent). */
  async preload(): Promise<void> {
    if (!this.hasApiKey()) return
    const err = await this.validateKey()
    this.keyValid = !err
    log(err ? `[api] stored key invalid: ${err}` : '[api] stored key validated')
  }

  /**
   * Stream a response for `prompt` (+ optional PNG) to all listeners.
   * Events: status {stage}, chunk {append, full}, done {full}, error {code, message}.
   */
  async submit(prompt: string, imageB64: string | null): Promise<void> {
    if (!this.apiKey) {
      this.emit('error', {
        code: 'NO_API_KEY',
        message: 'Connect Gemini first — create a free API key and paste it (Settings or the Home window).',
        needsLogin: true
      })
      return
    }
    if (this.active) {
      this.emit('error', { code: 'BUSY', message: 'Still answering the previous question — one moment.' })
      return
    }

    this.active = true
    this.emit('status', { stage: 'working', detail: imageB64 ? 'Reading your screenshot…' : 'Thinking…' })

    const parts: ChatPart[] = [{ text: prompt }]
    if (imageB64) parts.push({ inline_data: { mime_type: 'image/png', data: imageB64 } })

    const contents: ChatContent[] = [...this.history, { role: 'user', parts }]
    const payload = JSON.stringify({
      contents,
      generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
    })

    let full = ''
    let sseBuffer = ''
    let finished = false
    const startedAt = Date.now()

    const finish = (asError = false): void => {
      if (finished) return
      finished = true
      this.active = false
      if (!asError && full.length > 0) {
        // Persist the exchange so follow-up questions keep context.
        this.history.push({ role: 'user', parts: contents[contents.length - 1].parts })
        this.history.push({ role: 'model', parts: [{ text: full }] })
        while (this.history.length > MAX_HISTORY_ENTRIES) this.history.shift()
        this.emit('done', { full })
        log(`[api] response complete (${full.length} chars, ${Date.now() - startedAt}ms)`)
      } else if (!asError) {
        this.emit('error', { code: 'EMPTY_RESPONSE', message: 'Gemini returned an empty response. Try again.' })
      }
    }

    try {
      await this.rawRequest(
        'POST',
        `/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,
        payload,
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = ''
            res.on('data', (c: Buffer) => {
              errBody += c.toString('utf8')
              if (errBody.length > 8192) res.destroy()
            })
            res.on('end', () => {
              this.active = false
              finished = true
              this.emit('error', { code: 'API_ERROR', message: friendlyApiError(res.statusCode ?? 0, errBody) })
            })
            return
          }

          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            sseBuffer += chunk
            let idx: number
            while ((idx = sseBuffer.indexOf('\n')) >= 0) {
              const line = sseBuffer.slice(0, idx).trim()
              sseBuffer = sseBuffer.slice(idx + 1)
              if (!line.startsWith('data:')) continue
              const data = line.slice(5).trim()
              if (!data || data === '[DONE]') continue
              try {
                const parsed = JSON.parse(data)
                const parts = parsed?.candidates?.[0]?.content?.parts
                const delta = parts?.map((p: ChatPart) => p.text ?? '').join('') ?? ''
                if (delta) {
                  if (full.length === 0) log('[api] response streaming started')
                  full += delta
                  this.emit('chunk', { append: delta, full })
                  this.emit('status', { stage: 'streaming' })
                }
              } catch { /* partial JSON across chunks — SSE lines are complete though */ }
            }
          })
          res.on('end', () => finish())
          res.on('error', () => finish(true))
        },
        (err) => {
          this.active = false
          finished = true
          this.emit('error', {
            code: 'NETWORK',
            message: `Could not reach Google's API: ${String((err as Error)?.message ?? err)}`
          })
        }
      )
    } catch (err) {
      finish(true)
      this.emit('error', { code: 'API_ERROR', message: String((err as Error)?.message ?? err) })
    }
  }

  /** Minimal streaming-capable HTTPS request, straight to Google — no proxy. */
  private rawRequest(
    method: 'GET' | 'POST',
    pathAndQuery: string,
    body: string | null,
    onResponse?: (res: import('node:http').IncomingMessage) => void,
    onError?: (err: Error) => void
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string | number> = {
        'User-Agent': 'gemini-desktop-companion/2.0'
      }
      if (body) {
        headers['Content-Type'] = 'application/json'
        headers['Content-Length'] = Buffer.byteLength(body)
      }
      const req = https.request(
        { host: API_HOST, path: pathAndQuery, method, headers, timeout: 15000 },
        (res) => {
          resolve(res.statusCode ?? 0)
          onResponse?.(res)
          if (!onResponse) res.resume()
        }
      )
      req.on('timeout', () => {
        req.destroy()
        reject(new Error('timeout'))
      })
      req.on('error', (err) => {
        if (onError) onError(err)
        reject(err)
      })
      if (body) req.write(body)
      req.end()
    })
  }
}

function friendlyApiError(status: number, body: string): string {
  let detail = ''
  try {
    detail = JSON.parse(body)?.error?.message ?? ''
  } catch {
    detail = body.slice(0, 200)
  }
  if (status === 400 && /API key not valid/i.test(detail)) {
    return 'That API key is not valid. Paste a fresh one from aistudio.google.com/apikey.'
  }
  if (status === 403) {
    return 'Google rejected the request (403). Check that the key belongs to a project with the Generative Language API enabled.'
  }
  if (status === 429) {
    return 'Free-tier rate limit reached — wait a moment and try again.'
  }
  if (status === 404) {
    return 'Model not available for this key. Try the model setting again later.'
  }
  return detail || `Gemini API error (${status}).`
}

let apiSingleton: GeminiApiClient | null = null

export function getGeminiApi(): GeminiApiClient {
  if (!apiSingleton) apiSingleton = new GeminiApiClient()
  return apiSingleton
}
