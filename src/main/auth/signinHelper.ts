/**
 * Sign-in helper — runs inside an Electron utilityProcess (plain Node.js,
 * no Electron networking). Electron's main-process fetch/net routes through
 * the system proxy, which breaks loopback CDP calls on proxied machines;
 * this helper's node:http + WebSocket stack matches the verified standalone
 * probe exactly.
 *
 * Protocol (with the parent over parentPort):
 *   in:  { cmd: 'start', browserPath, profileDir, loginUrl }
 *   out: { type: 'progress', message }
 *        { type: 'done', cookies: CookieSpec[] }
 *        { type: 'failed', reason: 'no-browser' | 'closed' | 'timeout' }
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'

interface CookieSpec {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  expires: number
}

const SESSION_COOKIE_NAMES = new Set([
  '__Secure-1PSID',
  '__Secure-3PSID',
  'SAPISID',
  'SID',
  'HSID',
  'SSID',
  'APISID'
])

const ABSOLUTE_DEADLINE_MS = 5 * 60_000

function post(data: unknown): void {
  ;(process as unknown as { parentPort: { postMessage: (m: unknown) => void } }).parentPort.postMessage(data)
}

function progress(message: string): void {
  post({ type: 'progress', message })
}

function httpGetJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        let data = ''
        res.on('data', (c: string) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as Record<string, unknown>)
          } catch {
            resolve(null)
          }
        })
      })
      req.on('timeout', () => {
        req.destroy()
        resolve(null)
      })
      req.on('error', () => resolve(null))
    } catch {
      resolve(null)
    }
  })
}

/**
 * Minimal WebSocket client over node:http upgrade — the utility process has
 * no global WebSocket (Electron's Node 20), and one CDP command + one reply
 * is all we need. Client frames must be masked; server frames are not.
 */
function cdpCommand(port: number, method: string, timeoutMs = 6000): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const version = httpGetJson(`http://127.0.0.1:${port}/json/version`, 1500)
    void version.then((v) => {
      const wsUrl = (v as { webSocketDebuggerUrl?: string } | null)?.webSocketDebuggerUrl
      if (!wsUrl) {
        post({ type: 'progress', message: `cdp http probe failed on ${port}` })
        resolve(null)
        return
      }
      const endpoint = new URL(wsUrl)

      const key = crypto.randomBytes(16).toString('base64')
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: endpoint.pathname + endpoint.search,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': key,
          'Sec-WebSocket-Version': '13'
        },
        timeout: timeoutMs
      })

      let settled = false
      let timer: NodeJS.Timeout | null = setTimeout(() => finish(null), timeoutMs)
      let socket: import('node:net').Socket | null = null
      let buffer = Buffer.alloc(0)

      const finish = (result: Record<string, unknown> | null): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        try { socket?.destroy() } catch { /* ignore */ }
        resolve(result)
      }

      const handleData = (chunk: Buffer): void => {
        buffer = Buffer.concat([buffer, chunk])
        // Parse as many complete frames as the buffer holds.
        for (;;) {
          if (buffer.length < 2) return
          const opcode = buffer[0] & 0x0f
          const masked = (buffer[1] & 0x80) !== 0
          let len = buffer[1] & 0x7f
          let offset = 2
          if (len === 126) {
            if (buffer.length < 4) return
            len = buffer.readUInt16BE(2)
            offset = 4
          } else if (len === 127) {
            if (buffer.length < 10) return
            const big = buffer.readBigUInt64BE(2)
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) return
            len = Number(big)
            offset = 10
          }
          if (masked) offset += 4
          if (buffer.length < offset + len) return
          let payload = buffer.subarray(offset, offset + len)
          if (masked) {
            const mask = buffer.subarray(offset - 4, offset)
            const unmasked = Buffer.alloc(len)
            for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ mask[i % 4]
            payload = unmasked
          }
          buffer = buffer.subarray(offset + len)

          if (opcode === 0x8) {
            finish(null) // close frame
            return
          }
          if (opcode === 0x9) continue // ping — ignore (we close soon anyway)
          if (opcode === 0x1) {
            try {
              const msg = JSON.parse(payload.toString('utf8'))
              if (msg.id === 1) {
                finish((msg.result as Record<string, unknown>) ?? null)
                return
              }
            } catch { /* other message — keep waiting */ }
          }
        }
      }

      req.on('upgrade', (res, socketUpgraded) => {
        socket = socketUpgraded
        socket.setNoDelay(true)
        socket.on('data', handleData)
        socket.on('error', () => finish(null))
        socket.on('close', () => finish(null))
        // Send the command as one masked text frame.
        const payload = Buffer.from(JSON.stringify({ id: 1, method }), 'utf8')
        const mask = crypto.randomBytes(4)
        const len = payload.length
        let header: Buffer
        if (len < 126) {
          header = Buffer.from([0x81, 0x80 | len])
        } else if (len < 65536) {
          header = Buffer.alloc(4)
          header[0] = 0x81
          header[1] = 0x80 | 126
          header.writeUInt16BE(len, 2)
        } else {
          header = Buffer.alloc(10)
          header[0] = 0x81
          header[1] = 0x80 | 127
          header.writeUInt32BE(0, 2)
          header.writeUInt32BE(len, 6)
        }
        const masked = Buffer.alloc(len)
        for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4]
        socket.write(Buffer.concat([header, mask, masked]))
      })
      req.on('response', (res) => {
        // Server refused the upgrade.
        post({ type: 'progress', message: `cdp ws upgrade refused (${res.statusCode})` })
        finish(null)
      })
      req.on('timeout', () => finish(null))
      req.on('error', (err) => {
        post({ type: 'progress', message: `cdp ws error: ${String(err.message).slice(0, 80)}` })
        finish(null)
      })
      req.end()
    })
  })
}

function readDevToolsActivePort(profileDir: string): number {
  try {
    const file = path.join(profileDir, 'DevToolsActivePort')
    if (!existsSync(file)) return 0
    const first = readFileSync(file, 'utf8').split('\n')[0]?.trim() ?? ''
    const port = Number.parseInt(first, 10)
    return Number.isFinite(port) && port > 0 ? port : 0
  } catch {
    return 0
  }
}

function isGoogleDomain(domain: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase()
  return d === 'google.com' || d.endsWith('.google.com')
}

async function run(config: { browserPath: string; profileDir: string; loginUrl: string }): Promise<void> {
  progress('launching browser')
  const child = spawn(
    config.browserPath,
    [
      '--remote-debugging-port=0',
      `--user-data-dir=${config.profileDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      `--app=${config.loginUrl}`,
      '--window-size=560,800'
    ],
    { stdio: 'ignore' }
  )
  // The bootstrap may exit instantly on Windows — irrelevant; we track CDP.
  child.unref()

  const started = Date.now()
  const STARTUP_BUDGET_MS = 30_000
  let everUp = false
  let downStreak = 0
  let activePort = 0
  let lastCookieCount = -1

  while (Date.now() - started < ABSOLUTE_DEADLINE_MS) {
    await new Promise((r) => setTimeout(r, 2000))

    if (!activePort) {
      activePort = readDevToolsActivePort(config.profileDir)
      if (!activePort) {
        if (Date.now() - started > STARTUP_BUDGET_MS) {
          progress('browser never exposed a debugging port')
          post({ type: 'failed', reason: 'closed' })
          return
        }
        continue
      }
      progress(`browser CDP ready on port ${activePort}`)
    }

    const cookies = (await cdpCommand(activePort, 'Storage.getCookies')) as
      | { cookies?: CookieSpec[] }
      | null
    const list = cookies?.cookies
    if (list) {
      everUp = true
      downStreak = 0
      if (list.length !== lastCookieCount) {
        lastCookieCount = list.length
        progress(`${list.length} cookies visible`)
      }
      const sessionCookies = list.filter(
        (c) => SESSION_COOKIE_NAMES.has(c.name) && isGoogleDomain(c.domain)
      )
      if (sessionCookies.length > 0) {
        progress(`session cookies found (${sessionCookies.map((c) => c.name).join(', ')})`)
        await cdpCommand(activePort, 'Browser.close', 2500).catch(() => null)
        post({ type: 'done', cookies: list.filter((c) => isGoogleDomain(c.domain)) })
        return
      }
    } else if (everUp) {
      downStreak++
      if (downStreak >= 3) {
        progress('browser window closed')
        post({ type: 'failed', reason: 'closed' })
        return
      }
    }
  }
  post({ type: 'failed', reason: 'timeout' })
}

process.parentPort.on('message', (e: { data: { cmd?: string; browserPath?: string; profileDir?: string; loginUrl?: string } }) => {
  const msg = e.data
  if (msg?.cmd === 'start') {
    if (!existsSync(msg.browserPath ?? '')) {
      post({ type: 'failed', reason: 'no-browser' })
      return
    }
    void run({
      browserPath: msg.browserPath!,
      profileDir: msg.profileDir!,
      loginUrl: msg.loginUrl!
    }).catch((err) => post({ type: 'failed', reason: String(err) }))
  }
})
