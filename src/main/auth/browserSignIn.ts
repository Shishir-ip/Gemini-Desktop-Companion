import { app, net, session } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import nodeNet from 'node:net'
import path from 'node:path'
import { log } from '../logger'
import { getGeminiSession } from '../gemini/session'
import { pushLoginChanged } from '../windows/settingsWindow'
import { notifyTray } from '../tray'

/**
 * Sign-in with the user's REAL browser (Edge or Chrome).
 *
 * Google blocks embedded Chromium ("This browser or app may not be secure"),
 * so instead we open the actual installed browser in --app mode with a
 * dedicated profile inside our userData. The user signs in with the normal
 * Google UI they trust. Once the session cookies appear, we read them over
 * the local CDP port (loopback only) and import them into the app's
 * `persist:gemini` Electron session, then close the browser window.
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

const SESSION_COOKIE_NAMES = new Set([
  '__Secure-1PSID',
  '__Secure-3PSID',
  'SAPISID',
  'SID',
  'HSID',
  'SSID',
  'APISID'
])

export interface SignInResult {
  ok: boolean
  reason?: 'no-browser' | 'closed' | 'timeout'
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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = nodeNet.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))))
    })
    srv.on('error', reject)
  })
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

/** Fetch all cookies from a CDP-enabled browser endpoint. */
async function fetchCookiesViaCdp(port: number): Promise<CookieSpec[] | null> {
  try {
    const version = await net
      .fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(2000)
      })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
    const wsUrl = (version as { webSocketDebuggerUrl?: string } | null)?.webSocketDebuggerUrl
    if (!wsUrl) return null

    return await new Promise<CookieSpec[] | null>((resolve) => {
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => {
        try { ws.close() } catch { /* ignore */ }
        resolve(null)
      }, 4000)
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }))
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data))
          if (msg.id === 1) {
            clearTimeout(timer)
            const cookies = msg?.result?.cookies as CookieSpec[] | undefined
            try { ws.close() } catch { /* ignore */ }
            resolve(Array.isArray(cookies) ? cookies : null)
          }
        } catch {
          clearTimeout(timer)
          resolve(null)
        }
      }
      ws.onerror = () => {
        clearTimeout(timer)
        resolve(null)
      }
    })
  } catch {
    return null
  }
}

function sessionCookiesPresent(cookies: CookieSpec[]): boolean {
  return cookies.some(
    (c) =>
      SESSION_COOKIE_NAMES.has(c.name) &&
      /\.google\.com$/.test(c.domain.replace(/^\./, ''))
  )
}

/** Import Google cookies into the app's Gemini session partition. */
async function importCookies(cookies: CookieSpec[]): Promise<number> {
  const ses = session.fromPartition('persist:gemini')
  let count = 0
  for (const c of cookies) {
    const domain = c.domain.replace(/^\./, '')
    if (!/google\.com$/.test(domain) && !/gstatic\.com$/.test(domain)) continue
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

/** Open the real browser for sign-in; resolve when the session is imported. */
export async function signInWithBrowser(): Promise<SignInResult> {
  const browserPath = findBrowser()
  if (!browserPath) {
    log('[signin] no Edge/Chrome installation found')
    return { ok: false, reason: 'no-browser' }
  }

  const port = await freePort()
  const profileDir = path.join(app.getPath('userData'), 'signin-profile')
  log(`[signin] launching browser sign-in (port ${port})`)

  const proc = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection',
      `--app=${LOGIN_URL}`,
      '--window-size=560,800'
    ],
    { stdio: 'ignore' }
  )

  const deadline = Date.now() + 5 * 60_000
  let lastCookieCount = 0

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000))

    if (proc.pid === undefined || (await isProcessGone(proc))) {
      // The user may have closed the window before finishing, or after.
      // One last cookie check in case they signed in and closed quickly.
      const final = await fetchCookiesViaCdp(port)
      if (final && sessionCookiesPresent(final)) {
        await finishImport(final)
        return { ok: true }
      }
      log('[signin] browser closed before sign-in completed')
      return { ok: false, reason: 'closed' }
    }

    const cookies = await fetchCookiesViaCdp(port)
    if (cookies && sessionCookiesPresent(cookies)) {
      await finishImport(cookies)
      try { proc.kill() } catch { /* ignore */ }
      return { ok: true }
    }
    if (cookies && cookies.length !== lastCookieCount) {
      lastCookieCount = cookies.length
      log(`[signin] waiting for Google session cookies… (${cookies.length} cookies seen)`)
    }
  }
  try { proc.kill() } catch { /* ignore */ }
  log('[signin] timed out waiting for sign-in')
  return { ok: false, reason: 'timeout' }
}

async function finishImport(cookies: CookieSpec[]): Promise<void> {
  const count = await importCookies(cookies)
  log(`[signin] imported ${count} cookies into persist:gemini`)
  // Reload the hidden session so it picks up the fresh identity.
  await getGeminiSession().reload()
  await getGeminiSession().refreshLoginState()
  pushLoginChanged()
  const state = getGeminiSession().getCachedLoginState()
  if (state.loggedIn) {
    notifyTray('Google account connected', 'Gemini is ready — chats now save to your account history.')
  }
}

function isProcessGone(proc: ReturnType<typeof spawn>): Promise<boolean> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) {
      resolve(true)
      return
    }
    // On Windows, kill(0) isn't reliable in Node; poll exit events briefly.
    const once = () => resolve(true)
    proc.once('exit', once)
    setTimeout(() => {
      proc.off('exit', once)
      resolve(false)
    }, 50)
  })
}

/** Kept for IPC compatibility: opens the browser sign-in flow. */
export async function openLoginWindow(): Promise<void> {
  void signInWithBrowser().then((result) => {
    if (!result.ok && result.reason === 'no-browser') {
      notifyTray(
        'Sign-in unavailable',
        'Microsoft Edge or Google Chrome is required for Google sign-in.'
      )
    }
  })
}
