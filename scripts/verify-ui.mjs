/**
 * CDP UI verifier for Gemini Desktop Companion.
 *
 * Launch the app with `--remote-debugging-port=9222 --gdc-open=<page>`, then:
 *   node scripts/verify-ui.mjs 9222 [screenshotDir]
 *
 * Screenshots every page target, reports renderer readiness + console
 * exceptions, and can close targets with Esc (see --esc below).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const port = process.argv[2] ?? '9222'
const outDir = process.argv[3] ?? 'gdc-verify'
const escTarget = process.argv[4] ?? '' // e.g. "circle" — send Esc to matching target then exit
mkdirSync(outDir, { recursive: true })

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const pages = list.filter((t) => t.type === 'page')
console.log(`found ${pages.length} page target(s)`)
const usedNames = new Map()

function targetName(t) {
  const m = t.url.match(/(circle|gemini|settings|lensError)/)
  if (m) return m[1]
  if (t.url.includes('gemini.google.com')) return 'gemini-web'
  if (t.url.includes('devtools')) return 'devtools'
  return (t.url || 'unknown').replace(/[^a-z0-9]+/gi, '_').slice(0, 40)
}

for (const target of pages) {
  const name = targetName(target)
  console.log(`\n== [${name}] ${target.url}`)
  try {
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })

    let msgId = 0
    const pending = new Map()
    const events = []
    ws.onmessage = (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      } else if (msg.method) {
        events.push(msg.method)
        if (msg.method === 'Runtime.exceptionThrown') {
          console.log('   EXCEPTION:', JSON.stringify(msg.params?.exceptionDetails?.exception?.description ?? msg.params?.exceptionDetails?.text ?? '?').slice(0, 300))
        }
        if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
          console.log('   LOG-ERROR:', String(msg.params.entry.text).slice(0, 300))
        }
      }
    }
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = ++msgId
        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
      })

    await send('Runtime.enable')
    await send('Log.enable')
    await send('Page.enable')
    await new Promise((r) => setTimeout(r, 400))

    const evalRes = await send('Runtime.evaluate', {
      expression: `JSON.stringify({ ready: document.readyState, nodes: document.body ? document.body.children.length : -1, title: document.title })`,
      returnByValue: true
    })
    console.log('   state:', evalRes?.result?.result?.value)

    if (escTarget && name === escTarget) {
      for (const type of ['keyDown', 'keyUp']) {
        await send('Input.dispatchKeyEvent', {
          type,
          key: 'Escape',
          code: 'Escape',
          windowsVirtualKeyCode: 27,
          nativeVirtualKeyCode: 27
        })
      }
      console.log('   sent Esc')
      await new Promise((r) => setTimeout(r, 900))
    }

    const shot = await send('Page.captureScreenshot', { format: 'png' })
    const shotData = shot?.result?.data ?? shot?.data
    if (shotData) {
      let name = targetName(target) || 'target'
      const seen = usedNames.get(name) ?? 0
      usedNames.set(name, seen + 1)
      if (seen > 0) name = `${name}-${seen}`
      const file = join(outDir, `${name}.png`)
      writeFileSync(file, Buffer.from(shotData, 'base64'))
      console.log('   screenshot:', file)
    } else {
      console.log('   screenshot: FAILED', JSON.stringify(shot?.error ?? shot).slice(0, 160))
    }

    ws.close()
  } catch (err) {
    console.log('   ERROR:', String(err).slice(0, 200))
  }
}

console.log('\nremaining targets:', (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map((t) => targetName(t)).join(', ') || '(none)')
