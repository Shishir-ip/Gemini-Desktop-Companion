import { BrowserWindow, session as electronSession } from 'electron'
import { EventEmitter } from 'node:events'
import type { LoginState } from '../../shared/types'
import { chromeUserAgent, delay, preloadPath } from '../paths'
import { log } from '../logger'

const GEMINI_URL = 'https://gemini.google.com/app'

/** Page-side bridge: submits a prompt (text + optional PNG attachment). */
const PAGE_SUBMIT = `
window.__gdcSubmit = async ({ text, imageB64 }) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  try {
    // Dismiss first-run consent / intro dialogs if present.
    try {
      for (const label of ['continue', 'get started', 'i agree', 'accept', 'got it']) {
        const btn = [...document.querySelectorAll('button')].find((b) =>
          (b.textContent || '').trim().toLowerCase() === label && b.offsetParent !== null
        )
        if (btn) { btn.click(); await sleep(500) }
      }
    } catch (e) { /* no dialog — fine */ }

    const input =
      document.querySelector('rich-textarea .ql-editor[contenteditable="true"], div.ql-editor[contenteditable="true"]') ||
      document.querySelector('textarea')
    if (!input) return { ok: false, error: 'NO_INPUT' }

    if (imageB64) {
      try {
        const bin = atob(imageB64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const file = new File([bytes], 'screenshot.png', { type: 'image/png' })
        const dt = new DataTransfer()
        dt.items.add(file)

        // 1) a file input may already exist
        let fileInput = document.querySelector('input[type=file]')
        // 2) open Gemini's own "Upload & tools" button to materialise one
        if (!fileInput) {
          const uploadBtn = [...document.querySelectorAll('button')].find((b) =>
            /upload/i.test(b.getAttribute('aria-label') || '')
          )
          if (uploadBtn) {
            uploadBtn.click()
            await sleep(700)
            fileInput = document.querySelector('input[type=file]')
          }
        }
        // 3) the upload menu may need an explicit "Upload files" item
        if (!fileInput) {
          const item = [...document.querySelectorAll('[role="menuitem"], [role="option"], button, a')]
            .find((el) => /upload files?/i.test((el.textContent || '').trim()))
          if (item) {
            item.click()
            await sleep(1400)
            fileInput = document.querySelector('input[type=file]')
          }
        }
        if (fileInput) {
          fileInput.files = dt.files
          fileInput.dispatchEvent(new Event('change', { bubbles: true }))
          await sleep(1500)
        } else {
          // last resort: synthetic paste
          const evt = new Event('paste', { bubbles: true, cancelable: true })
          Object.defineProperty(evt, 'clipboardData', { value: dt })
          input.dispatchEvent(evt)
          await sleep(1500)
        }
      } catch (e) {
        console.warn('gdc: attachment failed', e)
      }
    }

    input.focus()
    if (input.tagName === 'TEXTAREA') {
      input.value = text
      input.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      document.execCommand('selectAll', false)
      document.execCommand('insertText', false, text)
    }
    await sleep(400)

    let sendBtn = null
    for (let i = 0; i < 50; i++) {
      sendBtn = Array.from(document.querySelectorAll('button')).find((b) => {
        const label = (b.getAttribute('aria-label') || b.getAttribute('mattooltip') || '').toLowerCase()
        return (label.includes('send') || label.includes('run')) && !b.disabled && b.offsetParent !== null
      })
      if (sendBtn) break
      await sleep(200)
    }

    if (sendBtn) {
      sendBtn.click()
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true
      }))
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}
`

/**
 * Page-side bridge: streaming response observer.
 *
 * Ground-truth notes (verified against the live DOM):
 *  - Assistant replies live in <model-response> / <message-content> custom
 *    elements. The pending user turn is <user-query>/<PENDING-REQUEST> and
 *    must NOT be captured — so we deliberately exclude
 *    `.conversation-container`, which matches both.
 *  - The text can sit in non-rendered containers where `innerText` returns
 *    "" — `textContent` always carries it.
 */
const PAGE_OBSERVER = `
if (!window.__gdcObserver) {
  window.__gdcBaseline = 0
  window.__gdcResetStream = () => {
    window.__gdcBaseline = document.querySelectorAll('model-response, message-content').length
  }
  window.__gdcResetStream()

  let lastText = ''
  let settle = null
  const RESPONSE_NODES = 'model-response, message-content'

  const getResponseText = () => {
    const nodes = document.querySelectorAll(RESPONSE_NODES)
    if (!nodes.length) return ''
    const el = nodes[nodes.length - 1]
    const md = el.querySelector('.markdown')
    const text = ((md || el).textContent || '').trim()
    return text
  }

  const flush = (settled) => {
    const count = document.querySelectorAll(RESPONSE_NODES).length
    if (count <= window.__gdcBaseline) return
    const t = getResponseText()
    if (t && t !== lastText) {
      lastText = t
      if (window.geminiPageBridge) window.geminiPageBridge.stream(t, settled)
    } else if (settled && t && t === lastText && window.geminiPageBridge) {
      window.geminiPageBridge.stream(t, true)
    }
  }

  const mo = new MutationObserver(() => {
    clearTimeout(settle)
    flush(false)
    settle = setTimeout(() => flush(true), 1500)
  })
  mo.observe(document.body, { childList: true, subtree: true, characterData: true })
  window.__gdcObserver = mo
}
`

export class GeminiSession extends EventEmitter {
  private win: BrowserWindow | null = null
  private loading: Promise<void> | null = null
  private streamText = ''
  private active = false
  private noResponseTimer: NodeJS.Timeout | null = null
  private hardTimer: NodeJS.Timeout | null = null
  private cachedLogin: LoginState = { loggedIn: false, unknown: true }
  private loginCheckedAt = 0
  private loginInflight: Promise<LoginState> | null = null

  /** Create (or reuse) the hidden Gemini web window and make sure it is loaded. */
  async ensureWindow(): Promise<BrowserWindow> {
    if (this.win && !this.win.isDestroyed()) {
      if (this.loading) await this.loading
      await this.injectBridges()
      return this.win
    }

    this.win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      skipTaskbar: true,
      backgroundColor: '#101014',
      webPreferences: {
        partition: 'persist:gemini',
        preload: preloadPath('geminiPage'),
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.webContents.on('render-process-gone', (_event, details) => {
      log(`[gemini] session renderer gone (${details.reason}) — resetting hidden window`)
      this.win = null
      this.loading = null
    })
    this.win.on('closed', () => {
      this.win = null
      this.loading = null
    })
    // Keep the streaming bridge alive across soft navigations.
    this.win.webContents.on('did-finish-load', () => {
      void this.injectBridges()
    })

    this.loading = (async () => {
      try {
        await this.win?.loadURL(GEMINI_URL)
        log('[gemini] hidden session loaded')
      } catch (err) {
        log(`[gemini] initial load failed: ${String(err)}`)
      }
      await delay(1200)
    })()
    await this.loading
    this.loading = null
    await this.injectBridges()
    return this.win
  }

  /** Warm up the hidden session in the background (called shortly after boot). */
  async preload(): Promise<void> {
    try {
      await this.ensureWindow()
      await this.refreshLoginState()
    } catch (err) {
      log(`[gemini] preload failed: ${String(err)}`)
    }
  }

  private async injectBridges(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    try {
      // Cheap idempotence check first — callers (login polling, submits)
      // invoke this often and the full injection is not free.
      const present = await this.win.webContents.executeJavaScript(
        '!!window.__gdcObserver && typeof window.__gdcSubmit === "function"'
      )
      if (present === true) return
      await this.win.webContents.executeJavaScript(PAGE_SUBMIT)
      await this.win.webContents.executeJavaScript(PAGE_OBSERVER)
    } catch {
      /* page mid-navigation — will retry on next did-finish-load */
    }
  }

  /**
   * Accurate Google sign-in detection. Ground truth: a signed-out page shows
   * an `accounts.google.com` "Sign in" link and has no profile avatar image;
   * containers like [data-ogsr-up] exist in BOTH states and must not be
   * treated as an avatar. Results are cached briefly so pollers don't hammer
   * the page with executeJavaScript.
   */
  async refreshLoginState(): Promise<LoginState> {
    if (this.loginInflight) return this.loginInflight
    if (Date.now() - this.loginCheckedAt < 10_000) {
      return this.cachedLogin
    }
    this.loginInflight = this.doRefreshLoginState().finally(() => {
      this.loginCheckedAt = Date.now()
      this.loginInflight = null
    })
    return this.loginInflight
  }

  private async doRefreshLoginState(): Promise<LoginState> {
    try {
      const win = await this.ensureWindow()
      const state = (await win.webContents.executeJavaScript(`(() => {
        try {
          return {
            ready: document.readyState === 'complete',
            onGemini: location.host === 'gemini.google.com',
            sorry: location.pathname.startsWith('/sorry'),
            avatarImg: !!document.querySelector('img.gbii, img.gbs, img[alt*="profile" i]'),
            signInLink: !!document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="accounts.google.com/v3/signin"], a[href*="ServiceLogin"]')
          }
        } catch (e) {
          return { ready: false, onGemini: false, sorry: false, avatarImg: false, signInLink: false }
        }
      })()`)) as {
        ready: boolean
        onGemini: boolean
        sorry: boolean
        avatarImg: boolean
        signInLink: boolean
      }

      const determined = state.onGemini && state.ready
      const previous = this.cachedLogin.loggedIn
      this.cachedLogin = {
        loggedIn: determined && !state.sorry ? state.avatarImg && !state.signInLink : false,
        unknown: !determined || state.sorry
      }
      if (state.sorry) {
        log('[gemini] Google served a verification page (/sorry) — treat session as undetermined')
      } else if (this.cachedLogin.loggedIn && !previous && !this.cachedLogin.unknown) {
        log('[gemini] Google account signed in — reloading hidden session')
        void this.reload()
      } else if (determined && previous !== this.cachedLogin.loggedIn) {
        log(`[gemini] login state changed: ${this.cachedLogin.loggedIn ? 'signed in' : 'signed out'}`)
      }
    } catch (err) {
      log(`[gemini] login check failed: ${String(err)}`)
      this.cachedLogin = { loggedIn: false, unknown: true }
    }
    return this.cachedLogin
  }

  getCachedLoginState(): LoginState {
    return this.cachedLogin
  }

  /** Reload the hidden page (used after sign-in so cookies take effect). */
  async reload(): Promise<void> {
    if (!this.win || this.win.isDestroyed()) return
    try {
      // Never let a stalled network hang the sign-in finish path.
      await Promise.race([
        this.win.loadURL(GEMINI_URL).then(async () => {
          await delay(1500)
          await this.injectBridges()
        }),
        new Promise((r) => setTimeout(r, 30_000))
      ])
    } catch (err) {
      log(`[gemini] reload failed: ${String(err)}`)
    }
  }

  /** Inject prompt + optional screenshot into the background Gemini page. */
  async submit(text: string, imageB64: string | null): Promise<void> {
    const win = await this.ensureWindow()
    this.streamText = ''
    this.active = true
    this.clearTimers()
    this.emit('status', { stage: 'working', detail: imageB64 ? 'Uploading screenshot…' : 'Thinking…' })

    // Signed-out Gemini rate-limits heavily; give it room, but never hang.
    this.noResponseTimer = setTimeout(() => {
      if (this.active && this.streamText.length === 0) {
        this.fail(
          'NO_RESPONSE',
          'Gemini did not return a response. If this keeps happening, make sure you are signed in — signed-out usage is heavily rate-limited.',
          true
        )
      }
    }, 60_000)
    this.hardTimer = setTimeout(() => {
      if (this.active && this.streamText.length > 0) {
        this.finish()
      } else if (this.active) {
        this.fail('NO_RESPONSE', 'Gemini did not respond in time. Please try again.', true)
      }
    }, 150_000)

    await win.webContents.executeJavaScript('window.__gdcResetStream && window.__gdcResetStream()')
    const result = (await win.webContents.executeJavaScript(
      `window.__gdcSubmit(${JSON.stringify({ text, imageB64 })})`,
      true
    )) as { ok: boolean; error?: string } | null

    if (!result || !result.ok) {
      this.fail(result?.error === 'NO_INPUT' ? 'PAGE_NOT_READY' : 'SUBMIT_FAILED',
        'Could not reach the Gemini page. Make sure you are signed in, then try again.',
        true)
    }
  }

  /** Start a fresh chat in the background session. */
  async newChat(): Promise<void> {
    const win = await this.ensureWindow()
    try {
      await win.webContents.executeJavaScript(`(() => {
        const btn = document.querySelector(
          '[aria-label*="New chat" i], a[href="/app"], [data-test-id="new-chat-button"]'
        )
        if (btn) { btn.click(); return true }
        return false
      })()`)
      await win.webContents.executeJavaScript('window.__gdcResetStream && window.__gdcResetStream()')
    } catch (err) {
      log(`[gemini] newChat failed: ${String(err)}`)
    }
  }

  /** Reveal the session window as a normal browser window (history & more). */
  async openVisible(): Promise<void> {
    const win = await this.ensureWindow()
    win.setAlwaysOnTop(false)
    win.setSkipTaskbar(false)
    win.show()
    win.focus()
  }

  /** Called from IPC when the page bridge streams text. */
  handleStream(full: string, settled: boolean): void {
    if (!this.active) return
    if (full.length > this.streamText.length) {
      if (this.streamText.length === 0) log('[gemini] response streaming started')
      const delta = full.slice(this.streamText.length)
      this.streamText = full
      this.emit('chunk', { append: delta, full })
      this.emit('status', { stage: 'streaming' })
    } else if (full !== this.streamText) {
      // Text shrank (cleanup pass) — send a replace.
      this.streamText = full
      this.emit('chunk', { append: '', full })
    }
    if (settled && this.streamText.length > 0) {
      this.finish()
    }
  }

  private finish(): void {
    if (!this.active) return
    this.active = false
    this.clearTimers()
    log(`[gemini] response complete (${this.streamText.length} chars)`)
    this.emit('done', { full: this.streamText })
  }

  private fail(code: string, message: string, needsLogin = false): void {
    if (!this.active) return
    this.active = false
    this.clearTimers()
    log(`[gemini] failed: ${code}`)
    this.emit('error', { code, message, needsLogin })
  }

  private clearTimers(): void {
    if (this.noResponseTimer) {
      clearTimeout(this.noResponseTimer)
      this.noResponseTimer = null
    }
    if (this.hardTimer) {
      clearTimeout(this.hardTimer)
      this.hardTimer = null
    }
  }
}

let sessionSingleton: GeminiSession | null = null

export function getGeminiSession(): GeminiSession {
  if (!sessionSingleton) sessionSingleton = new GeminiSession()
  return sessionSingleton
}

/**
 * Deny every permission request (notifications, geolocation, …) on the
 * Google-facing sessions so the hidden Gemini tab can never leak its
 * response previews as Windows toasts.
 */
export function applyPermissionGuards(): void {
  for (const name of ['persist:gemini', 'persist:lens']) {
    const ses = electronSession.fromPartition(name)
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    ses.setPermissionCheckHandler(() => false)
  }
}

/** Apply the Chrome-like user agent to every Google-facing session. */
export function applyGoogleFriendlyUserAgents(): void {
  const ua = chromeUserAgent()
  electronSession.defaultSession.setUserAgent(ua)
  electronSession.fromPartition('persist:gemini').setUserAgent(ua)
  electronSession.fromPartition('persist:lens').setUserAgent(ua)
}
