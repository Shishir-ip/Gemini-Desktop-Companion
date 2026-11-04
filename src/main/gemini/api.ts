import { safeStorage } from 'electron'
import { EventEmitter } from 'node:events'
import https from 'node:https'
import { store } from '../store'
import { log } from '../logger'

/**
 * Gemini via the OFFICIAL API (Google AI Studio key) — the reliable path.
 *
 * Transport rules learned from production failures:
 *  - node:https connects DIRECT (system proxies broke net.fetch and SSE POSTs)
 *  - a stalled stream must NEVER be invisible: first-byte, idle and overall
 *    watchdogs start BEFORE the request and abort with a specific error
 *  - requests cancel-and-replace: a new question aborts the in-flight one
 *  - keepAlive TLS connections; thinking disabled for lowest TTFT
 *  - every event is tagged with its stream target ('widget' | 'results')
 */

const API_HOST = 'generativelanguage.googleapis.com'
export const MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'] as const
export type ModelId = (typeof MODELS)[number]
const DEFAULT_MODEL: ModelId = 'gemini-3.8-flash'
const FIRST_BYTE_TIMEOUT_MS = 60_000
const IDLE_TIMEOUT_MS = 20_000
const OVERALL_TIMEOUT_MS = 120_000
// Small context = faster serialization + shorter model preamble.
const MAX_HISTORY_ENTRIES = 8

// Reuse TLS connections across requests — a fresh handshake per call adds
// hundreds of ms on high-latency networks.
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 8 })

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
  private model: ModelId = DEFAULT_MODEL
  private history: ChatContent[] = []
  private active = false
  private gen = 0
  private abortFn: (() => void) | null = null

  constructor() {
    super()
    this.loadKey()
  }

  private loadKey(): void {
    try {
      const stored = store.get('apiKeyEnc') as string | undefined
      if (!stored) return
      if (safeStorage.isEncryptionAvailable()) {
        this.apiKey = safeStorage.decryptString(Buffer.from(stored, 'base64'))
      } else {
        this.apiKey = Buffer.from(stored, 'base64').toString('utf8')
      }
      this.keyValid = true
      const storedModel = store.get('apiModel') as ModelId | undefined
      if (storedModel && MODELS.includes(storedModel)) this.model = storedModel
    } catch (err) {
      log(`[api] failed to load stored key: ${String(err)}`)
      this.apiKey = ''
      this.keyValid = false
    }
  }

  hasApiKey(): boolean {
    return this.apiKey.length > 0
  }

  getModel(): ModelId {
    return this.model
  }

  /** Switch model; persists the choice. Returns an error message or null. */
  setModel(model: string): string | null {
    if (!MODELS.includes(model as ModelId)) {
      return `Unknown model "${model}". Available: ${MODELS.join(', ')}.`
    }
    this.model = model as ModelId
    store.set('apiModel', this.model)
    log(`[api] model switched to ${this.model}`)
    return null
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
      if (status === 400 || status === 403)
        return 'That key was rejected by Google. Double-check it (a full AI Studio key starts with "AIza").'
      if (status === 429) return 'Rate limited by Google — try again in a minute.'
      if (status === 503) return 'Google is overloaded right now (503) — try again in a few seconds.'
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
   * Stream a chat response to listeners with target 'widget'.
   * Events: status, chunk, done, error — every payload carries its target.
   */
  async submit(prompt: string, imageB64: string | null): Promise<void> {
    if (!this.apiKey) {
      this.emit('error', {
        code: 'NO_API_KEY',
        message: 'Connect Gemini first — create a free API key and paste it (Settings or the Home window).',
        needsKey: true,
        target: 'widget'
      })
      return
    }
    const parts: ChatPart[] = [{ text: prompt }]
    if (imageB64) parts.push({ inline_data: { mime_type: 'image/png', data: imageB64 } })
    const contents: ChatContent[] = [...this.history, { role: 'user', parts }]
    await this.streamOnce(contents, { persist: true, startedLabel: 'chat', target: 'widget', rateRetries: 3 })
  }

  /**
   * One-shot vision analysis (Circle to Search results panel) with Google
   * Search grounding — real web results with source links. If a model
   * rejects the search tool, it retries once without grounding.
   */
  async submitVision(prompt: string, imageB64: string): Promise<void> {
    if (!this.apiKey) {
      this.emit('error', {
        code: 'NO_API_KEY',
        message: 'Connect Gemini first.',
        needsKey: true,
        target: 'results'
      })
      return
    }
    const contents: ChatContent[] = [
      { role: 'user', parts: [{ text: prompt }, { inline_data: { mime_type: 'image/png', data: imageB64 } }] }
    ]
    await this.streamOnce(contents, {
      persist: false,
      startedLabel: 'vision',
      target: 'results',
      useTools: true,
      rateRetries: 3
    })
  }

  /**
   * Cancel-and-replace: starting a new request aborts the in-flight one
   * instantly. Stale callbacks (old generation) emit nothing — so pressing
   * send again can never produce 'BUSY' or a vanished message.
   */
  cancelActive(): void {
    if (this.active) {
      this.gen++
      try { this.abortFn?.() } catch { /* ignore */ }
      this.active = false
      log('[api] in-flight request cancelled (superseded)')
    }
  }

  private async streamOnce(
    contents: ChatContent[],
    opts: {
      persist: boolean
      startedLabel: string
      target: 'widget' | 'results'
      modelOverride?: string
      fallbackUsed?: boolean
      useTools?: boolean
      thinkingOff?: boolean
      rateRetries?: number
    }
  ): Promise<void> {
    this.cancelActive()
    const myGen = ++this.gen
    const stale = (): boolean => myGen !== this.gen
    const model = opts.modelOverride ?? this.model
    // Targeted emits: events carry their stream's target so each surface
    // (palette / results panel) renders only its own stream.
    const emitT = (channel: string, payload: Record<string, unknown>): void => {
      if (!stale()) this.emit(channel, { ...payload, target: opts.target })
    }
    this.active = true
    emitT('status', {
      stage: 'working',
      detail: contents.some((c) => c.parts.some((p) => p.inline_data)) ? 'Reading your screenshot…' : 'Thinking…'
    })

    const payload = JSON.stringify({
      contents,
      // Thinking is the #1 latency cost on flash models (dynamic thinking
      // burns seconds before the first token). Disabled explicitly; if a
      // model rejects the field, the error path retries without it.
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
        ...(opts.thinkingOff ? {} : { thinkingConfig: { thinkingBudget: 0 } })
      },
      ...(opts.useTools ? { tools: [{ google_search: {} }] } : {})
    })
    const sources: { title: string; uri: string }[] = []

    let full = ''
    let sseBuffer = ''
    let finished = false
    let gotFirstByte = false
    let firstByteAt = 0
    let lastDataAt = Date.now()
    let usage = ''
    const startedAt = Date.now()

    const cleanup = (res?: import('node:http').IncomingMessage): void => {
      finished = true
      if (stale()) this.active = false
      try { res?.destroy() } catch { /* ignore */ }
    }

    const finishOk = (res?: import('node:http').IncomingMessage): void => {
      if (finished || stale()) return
      if (full.length > 0) {
        if (opts.persist) {
          this.history.push({ role: 'user', parts: contents[contents.length - 1].parts })
          this.history.push({ role: 'model', parts: [{ text: full }] })
          while (this.history.length > MAX_HISTORY_ENTRIES) this.history.shift()
        }
        cleanup(res)
        const ttft = firstByteAt ? firstByteAt - startedAt : 0
        emitT('done', { full, sources, ttftMs: ttft, usage })
        log(
          `[api] ${opts.startedLabel} complete (${full.length} chars, total=${Date.now() - startedAt}ms, ttft=${ttft}ms, model=${model}, usage=${usage || 'n/a'})`
        )
      } else {
        cleanup(res)
        emitT('error', {
          code: 'EMPTY_RESPONSE',
          message: 'Gemini returned an empty response. Try again, or switch models in the palette.'
        })
        log(`[api] ${opts.startedLabel} empty response after ${Date.now() - startedAt}ms`)
      }
    }

    const fail = (code: string, message: string, res?: import('node:http').IncomingMessage): void => {
      if (finished || stale()) return
      cleanup(res)
      emitT('error', { code, message })
      log(`[api] ${opts.startedLabel} failed: ${code} (${Date.now() - startedAt}ms)`)
    }

    // Watchdogs start IMMEDIATELY — before the request — so a stall during
    // connect/TLS/headers can never be invisible (the exact "keeps thinking,
    // never responds" bug: the interval used to be created only after
    // await rawRequest(...), which never resolved on a pre-header stall).
    let reqHandle: import('node:http').ClientRequest | null = null
    const watchdog = setInterval(() => {
      if (finished || stale()) {
        clearInterval(watchdog)
        return
      }
      const now = Date.now()
      if (!gotFirstByte && now - startedAt > FIRST_BYTE_TIMEOUT_MS) {
        clearInterval(watchdog)
        try { reqHandle?.destroy(new Error('first-byte timeout')) } catch { /* ignore */ }
        fail(
          'NETWORK',
          "Google's API did not start responding in time — your network or proxy may be blocking generativelanguage.googleapis.com. Try again."
        )
        return
      }
      if (gotFirstByte && now - lastDataAt > IDLE_TIMEOUT_MS) {
        clearInterval(watchdog)
        if (full.length > 0) {
          log(`[api] stream idle ${IDLE_TIMEOUT_MS}ms — finishing with partial answer`)
          finishOk()
        } else {
          try { reqHandle?.destroy(new Error('idle before content')) } catch { /* ignore */ }
          fail('NETWORK', 'The stream stalled before any content arrived. Try again.')
        }
        return
      }
      if (now - startedAt > OVERALL_TIMEOUT_MS) {
        clearInterval(watchdog)
        if (full.length > 0) {
          log('[api] overall deadline reached — finishing with partial answer')
          finishOk()
        } else {
          fail('NETWORK', 'The response took too long. Try again.')
        }
      }
    }, 1500)

    try {
      await this.rawRequest(
        'POST',
        `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.apiKey)}`,
        payload,
        (res) => {
          if (res.statusCode !== 200) {
            let errBody = ''
            res.on('data', (c: Buffer) => {
              errBody += c.toString('utf8')
              if (errBody.length > 8192) res.destroy()
            })
            res.on('end', () => {
              finished = true
              this.active = false
              clearInterval(watchdog)
              const status = res.statusCode ?? 0
              // Free-tier per-minute quota: auto-retry with backoff instead
              // of dead-ending.
              const rateLeft = opts.rateRetries ?? 0
              if (status === 429 && rateLeft > 0) {
                const delayS = rateLeft === 3 ? 8 : rateLeft === 2 ? 16 : 30
                finished = true
                this.active = false
                clearInterval(watchdog)
                emitT('status', {
                  stage: 'working',
                  detail: `Rate limited by the free tier — retrying in ${delayS}s…`
                })
                log(`[api] ${opts.startedLabel} 429 — retrying in ${delayS}s (${rateLeft - 1} retries left)`)
                setTimeout(() => {
                  void this.streamOnce(contents, {
                    ...opts,
                    rateRetries: rateLeft - 1
                  }).catch(() => {})
                }, delayS * 1000)
                return
              }
              // Some models reject the google_search tool — retry once
              // without grounding rather than failing.
              if (status === 400 && opts.useTools && /google_search|tool|search/i.test(errBody)) {
                log(`[api] ${opts.startedLabel} search tool rejected — retrying without grounding`)
                emitT('status', { stage: 'working', detail: 'Searching without web grounding…' })
                void this.streamOnce(contents, {
                  ...opts,
                  useTools: false
                }).catch(() => {})
                return
              }
              // thinkingConfig rejected (model/key dependent) — retry once without
              // it so an answer always comes; dynamic thinking then applies.
              if (status === 400 && !opts.thinkingOff) {
                log(`[api] ${opts.startedLabel} thinkingConfig rejected — retrying without it`)
                emitT('status', { stage: 'working', detail: 'Retrying…' })
                void this.streamOnce(contents, { ...opts, thinkingOff: true }).catch(() => {})
                return
              }
              // Google overloaded (free tier): transparently retry ONCE with
              // the other model rather than surfacing a dead end.
              if ((status === 503 || status === 500) && !opts.fallbackUsed) {
                const other = MODELS.find((m) => m !== model)
                if (other) {
                  log(`[api] ${opts.startedLabel} ${status} on ${model} — retrying once with ${other}`)
                  emitT('status', {
                    stage: 'working',
                    detail: 'Google is overloaded — retrying with the other model…'
                  })
                  void this.streamOnce(contents, {
                    ...opts,
                    modelOverride: other,
                    fallbackUsed: true
                  }).catch(() => {})
                  return
                }
              }
              emitT('error', { code: 'API_ERROR', message: friendlyApiError(status, errBody) })
              log(`[api] ${opts.startedLabel} API error ${status}`)
            })
            return
          }

          res.setEncoding('utf8')
          res.on('data', (chunk: string) => {
            if (finished) return
            if (!gotFirstByte) {
              gotFirstByte = true
              firstByteAt = Date.now()
              log(
                `[api] ${opts.startedLabel} streaming started (${firstByteAt - startedAt}ms to first byte, model=${model}, thinkingOff=${!!opts.thinkingOff})`
              )
            }
            lastDataAt = Date.now()
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
                if (parsed?.usageMetadata) {
                  usage = JSON.stringify(parsed.usageMetadata)
                }
                const chunks = parsed?.candidates?.[0]?.groundingMetadata?.groundingChunks
                if (Array.isArray(chunks)) {
                  for (const c of chunks) {
                    const uri = c?.web?.uri
                    const title = c?.web?.title ?? uri
                    if (uri && title && !sources.some((x) => x.uri === uri)) {
                      sources.push({ title: String(title).slice(0, 120), uri: String(uri) })
                    }
                  }
                }
                if (delta) {
                  full += delta
                  emitT('chunk', { append: delta, full })
                  emitT('status', { stage: 'streaming' })
                }
              } catch { /* keep buffered remainder */ }
            }
          })
          res.on('end', () => finishOk(res))
          res.on('error', () => finishOk(res))
        },
        (err) => {
          clearInterval(watchdog)
          fail('NETWORK', `Could not reach Google's API: ${String((err as Error)?.message ?? err)}`)
        },
        (req) => {
          reqHandle = req
          this.abortFn = () => {
            try { reqHandle?.destroy(new Error('cancelled')) } catch { /* ignore */ }
          }
        }
      ).catch((err) => {
        clearInterval(watchdog)
        fail('NETWORK', `Could not reach Google's API: ${String((err as Error)?.message ?? err)}`)
      })
    } catch (err) {
      clearInterval(watchdog)
      fail('API_ERROR', String((err as Error)?.message ?? err))
    }
  }

  /** Minimal HTTPS request. Streaming responses are handled via onResponse. */
  private rawRequest(
    method: 'GET' | 'POST',
    pathAndQuery: string,
    body: string | null,
    onResponse?: (res: import('node:http').IncomingMessage) => void,
    onError?: (err: Error) => void,
    onRequest?: (req: import('node:http').ClientRequest) => void
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
        {
          host: API_HOST,
          path: pathAndQuery,
          method,
          headers,
          timeout: method === 'GET' ? 15000 : 0,
          agent: keepAliveAgent
        },
        (res) => {
          resolve(res.statusCode ?? 0)
          onResponse?.(res)
          if (!onResponse) res.resume()
        }
      )
      onRequest?.(req)
      if (method === 'GET') {
        req.on('timeout', () => {
          req.destroy()
          reject(new Error('timeout'))
        })
      }
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
  if (status === 503) {
    return 'Google is overloaded right now (503). Try again in a few seconds, or switch models in the palette.'
  }
  if (status === 500) {
    return 'Google hit an internal error (500). Try again — possibly with the other model.'
  }
  if (status === 404) {
    return `This model isn't available for your key (${status}). Try switching models in the palette.`
  }
  return detail || `Gemini API error (${status}).`
}

let apiSingleton: GeminiApiClient | null = null

export function getGeminiApi(): GeminiApiClient {
  if (!apiSingleton) apiSingleton = new GeminiApiClient()
  return apiSingleton
}
