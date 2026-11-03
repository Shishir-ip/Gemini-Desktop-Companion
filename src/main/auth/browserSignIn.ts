import { app, session, utilityProcess } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { log } from '../logger'
import { getGeminiSession } from '../gemini/session'
import { pushLoginChanged } from '../windows/settingsWindow'
import { notifyTray } from '../tray'

/**
 * Sign-in with the user's REAL browser (Edge or Chrome).
 *
 * Google blocks embedded Chromium sign-in ("This browser or app may not be
 * secure"), so we open the actual installed browser in --app mode with a
 * dedicated profile inside our userData, watch the loopback CDP endpoint for
 * Google session cookies, import them into the app's `persist:gemini`
 * session, and close the browser window.
 *
 * The spawn+poll runs inside an Electron utilityProcess (plain Node.js):
 * Electron's main-process networking routes through the system proxy, which
 * breaks loopback CDP on proxied machines. The helper protocol is documented
 * in signinHelper.ts.
 */

const BROWSER_CANDIDATES = [
  // Edge ships with every Windows 10/11 install
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  // Chrome fallbacks
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(app.getPath('home'), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
]

const LOGIN_URL =
  'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp&hl=en'

export interface SignInResult {
  ok: boolean
  reason?: 'no-browser' | 'closed' | 'timeout'
}

interface CookieSpec {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expires: number
}

function findBrowser(): string | null {
  for (const p of BROWSER_CANDIDATES) {
    try {
      if (existsSync(p)) return p
    } catch {
      /* continue */
    }
  }
  return null
}

/** Import Google cookies into the app's Gemini session partition. */
async function importCookies(cookies: CookieSpec[]): Promise<number> {
  const ses = session.fromPartition('persist:gemini')
  let count = 0
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, '')
    if (!/google\.com$/.test(domain)) continue
    try {
      await ses.cookies.set({
        url: `https://${domain}${c.path || '/'}`,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure,
        httpOnly: c.httpOnly,
        expirationDate: c.expires > 0 ? c.expires : undefined
      })
      count++
    } catch (err) {
      log(`[signin] cookie ${c.name} import failed: ${String(err)}`)
    }
  }
  return count
}

async function finishSignIn(cookies: CookieSpec[]): Promise<void> {
  const count = await importCookies(cookies)
  log(`[signin] imported ${count} cookies into persist:gemini`)
  // Reload the hidden session so it picks up the fresh identity.
  await getGeminiSession().reload()
  // The avatar/sign-in header renders late — give the check a few tries.
  let state = { loggedIn: false, unknown: true }
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 2500))
    state = await getGeminiSession().refreshLoginState()
    if (state.loggedIn) break
  }
  pushLoginChanged()
  if (state.loggedIn) {
    notifyTray('Google account connected', 'Gemini is ready — chats now save to your account history.')
  } else {
    log('[signin] cookies imported but login check still reports signed out')
  }
}

let inFlight: Promise<SignInResult> | null = null

/** Open the real browser for sign-in; resolve when the session is imported. */
export function signInWithBrowser(): Promise<SignInResult> {
  // Repeated clicks must not spawn a fleet of browser windows.
  if (inFlight) return inFlight
  inFlight = doSignInWithBrowser().finally(() => {
    inFlight = null
  })
  return inFlight
}

function doSignInWithBrowser(): Promise<SignInResult> {
  return new Promise<SignInResult>(async (resolve) => {
    try {
      const browserPath = findBrowser()
      if (!browserPath) {
        log('[signin] no Edge/Chrome installation found')
        resolve({ ok: false, reason: 'no-browser' })
        return
      }

      // Already signed in? Don't pop a browser at all.
      const state = await getGeminiSession().refreshLoginState()
      if (state.loggedIn) {
        log('[signin] already signed in — nothing to do')
        pushLoginChanged()
        resolve({ ok: true })
        return
      }

      const profileDir = path.join(app.getPath('userData'), 'signin-profile')
      log(`[signin] launching browser sign-in (helper, profile ${profileDir})`)

      let settled = false
      const settle = (result: SignInResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { helper.kill() } catch { /* ignore */ }
        resolve(result)
      }

      const helper = utilityProcess.fork(path.join(__dirname, 'signinHelper.js'), [], {
        serviceName: 'gdc-signin'
      })

      const timer = setTimeout(() => {
        log('[signin] timed out waiting for sign-in')
        settle({ ok: false, reason: 'timeout' })
      }, 5 * 60_000)

      helper.on('message', (msg: { type?: string; message?: string; reason?: string; cookies?: CookieSpec[] }) => {
        if (msg.type === 'progress' && msg.message) {
          log(`[signin] ${msg.message}`)
        } else if (msg.type === 'done' && Array.isArray(msg.cookies)) {
          log(`[signin] helper returned ${msg.cookies.length} Google cookies`)
          void finishSignIn(msg.cookies)
          settle({ ok: true })
        } else if (msg.type === 'failed') {
          const reason = (msg.reason as SignInResult['reason']) ?? 'closed'
          log(`[signin] helper failed: ${reason}`)
          if (reason === 'closed') {
            notifyTray('Sign-in not finished', 'The browser window closed before sign-in completed. Try again anytime.')
          }
          settle({ ok: false, reason })
        }
      })
      helper.on('exit', () => {
        // If the helper died without reporting, surface a failure.
        setTimeout(() => settle({ ok: false, reason: 'closed' }), 500)
      })

      helper.postMessage({
        cmd: 'start',
        browserPath,
        profileDir,
        loginUrl: LOGIN_URL
      })
    } catch (err) {
      log(`[signin] flow error: ${String(err)}`)
      resolve({ ok: false, reason: 'closed' })
    }
  })
}

/** Kept for IPC compatibility: opens the browser sign-in flow. */
export async function openLoginWindow(): Promise<void> {
  const result = await signInWithBrowser()
  if (!result.ok && result.reason === 'no-browser') {
    notifyTray(
      'Sign-in unavailable',
      'Microsoft Edge or Google Chrome is required for Google sign-in.'
    )
  } else if (!result.ok && result.reason === 'closed') {
    notifyTray('Sign-in not finished', 'The browser window closed before sign-in completed. Try again anytime.')
  }
}
