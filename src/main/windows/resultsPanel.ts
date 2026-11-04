import { BrowserWindow } from 'electron'
import type { Display, Rectangle } from 'electron'
import path from 'node:path'
import { searchLens } from '../gemini/lens'
import { animateWindowBounds } from '../animate'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'
import { IPC } from '../../shared/ipc'

let panel: BrowserWindow | null = null
let lastCrop: string | null = null

/**
 * Circle-to-Search results panel. Shows the crop, streams a Gemini vision
 * analysis (the reliable API path), and offers "Open in Google Lens" as the
 * classic fallback.
 */
export function openResultsPanel(display: Display, dataUrl: string): void {
  closePanel(true)
  lastCrop = dataUrl

  const wa = display.workArea
  const margin = 12
  const width = 500
  const height = wa.height - margin * 2
  const target: Rectangle = {
    x: wa.x + wa.width - width - margin,
    y: wa.y + margin,
    width,
    height
  }
  const start: Rectangle = { ...target, x: display.bounds.x + display.bounds.width + 60 }

  panel = new BrowserWindow({
    ...start,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    backgroundColor: '#101014',
    roundedCorners: true,
    webPreferences: {
      preload: preloadPath('index'),
      partition: 'persist:lens',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  panel.setAlwaysOnTop(true, 'screen-saver')
  panel.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.)?google\./.test(url) || /lens\.google\.com/.test(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } }
    }
    void import('../ipcUtils').then(({ openExternalUrl }) => openExternalUrl(url))
    return { action: 'deny' }
  })
  panel.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
    }
  })
  panel.webContents.on('did-fail-load', (_event, code, desc, _url, isMainFrame) => {
    if (!isMainFrame) return
    log(`[results] panel load failed (${code} ${desc}) — closing search UI`)
    void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
  })
  panel.webContents.on('render-process-gone', (_event, details) => {
    log(`[results] panel renderer gone (${details.reason}) — closing search UI`)
    void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
  })
  // TTS/read-aloud injection only applies once we navigate INTO Google Lens.
  panel.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      if (panel && !panel.isDestroyed() && panel.webContents.getURL().includes('google.')) {
        void panel.webContents.executeJavaScript(LENS_TTS_SCRIPT).catch(() => {})
      }
    }, 1200)
  })
  panel.on('closed', () => {
    panel = null
  })

  loadRendererPage(panel, 'results')
  panel.once('ready-to-show', () => {
    if (!panel || panel.isDestroyed()) return
    panel.show()
    animateWindowBounds(panel, start, target, 240)
  })
}

/** Navigate the panel into Google Lens for the stored crop. */
export async function openLensForCrop(): Promise<boolean> {
  if (!panel || panel.isDestroyed() || !lastCrop) return false
  const result = await searchLens(lastCrop)
  if (!panel || panel.isDestroyed()) return false
  if (result.ok) {
    await panel.loadURL(result.url).catch(() => {
      /* navigation errors are non-fatal — the page still renders */
    })
    return true
  }
  return false
}

export function getLastCrop(): string | null {
  return lastCrop
}

export function closePanel(immediate = false): void {
  if (!panel) return
  const p = panel
  panel = null
  if (immediate || p.isDestroyed()) {
    if (!p.isDestroyed()) p.destroy()
    return
  }
  const bounds = p.getBounds()
  animateWindowBounds(p, bounds, { ...bounds, x: bounds.x + bounds.width + 80 }, 180)
  setTimeout(() => {
    if (!p.isDestroyed()) p.destroy()
  }, 200)
}

export function hasResultsPanel(): boolean {
  return panel !== null && !panel!.isDestroyed()
}

export function getPanelWindow(): BrowserWindow | null {
  return panel && !panel.isDestroyed() ? panel : null
}

/** Forward API streaming events into the results panel (if open). */
export function forwardResultsEvent(channel: string, payload: unknown): void {
  if (panel && !panel.isDestroyed()) {
    panel.webContents.send(channel, payload)
  }
}

export { IPC }

/**
 * Injects speaker buttons next to text blocks on the Google Lens page plus a
 * floating "read all / stop" bar. Inline styles only; addEventListener-based.
 */
const LENS_TTS_SCRIPT = `
(function () {
  if (window.__gdcTtsInstalled) return
  window.__gdcTtsInstalled = true

  var SELECTOR = '.PZPmff, .DeqbSh, .iRPxcb, .UAU3ec, .wDYxhc, .LGOjhe, .hgPElc, .V1Ddwd, p, li, h1, h2, h3, blockquote'
  var BTN_CSS = 'position:absolute;top:-2px;right:-2px;width:22px;height:22px;border-radius:11px;' +
    'border:1px solid rgba(255,255,255,0.25);background:rgba(30,30,34,0.85);color:#dbeafe;' +
    'display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:99999;' +
    'box-shadow:0 2px 8px rgba(0,0,0,0.35);backdrop-filter:blur(8px);font-size:11px;line-height:1;'

  function textOf(el) { return (el.innerText || '').trim() }

  function shouldDecorate(el) {
    var t = textOf(el)
    if (t.length < 25 || t.length > 4000) return false
    var hasBlockChild = false
    for (var i = 0; i < el.children.length; i++) {
      if (el.children[i].classList.contains('gdc-tts-btn')) continue
      if (textOf(el.children[i]).length > 20) { hasBlockChild = true; break }
    }
    return !hasBlockChild
  }

  function speak(text, btn) {
    try {
      window.speechSynthesis.cancel()
      var u = new SpeechSynthesisUtterance(text)
      u.rate = 1
      u.onend = u.onerror = function () { if (btn) btn.textContent = '🔊' }
      if (btn) btn.textContent = '⏹'
      window.speechSynthesis.speak(u)
    } catch (e) {}
  }

  function makeBtn(text) {
    var btn = document.createElement('button')
    btn.className = 'gdc-tts-btn'
    btn.setAttribute('aria-label', 'Read this text aloud')
    btn.style.cssText = BTN_CSS
    btn.textContent = '🔊'
    btn.title = 'Read aloud'
    btn.addEventListener('click', function (e) {
      e.preventDefault()
      e.stopPropagation()
      if (btn.textContent === '⏹') {
        try { window.speechSynthesis.cancel() } catch (err) {}
        btn.textContent = '🔊'
        return
      }
      speak(text, btn)
    })
    return btn
  }

  function decorate() {
    var nodes = document.querySelectorAll(SELECTOR)
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i]
      if (el.__gdcTts) continue
      el.__gdcTts = true
      if (!shouldDecorate(el)) continue
      var pos = getComputedStyle(el).position
      if (pos === 'static' || !pos) el.style.position = 'relative'
      el.appendChild(makeBtn(textOf(el)))
    }
  }

  var bar = document.createElement('div')
  bar.style.cssText = 'position:fixed;top:10px;right:10px;z-index:2147483647;display:flex;gap:6px;' +
    'font-family:system-ui,sans-serif;'
  var readAll = document.createElement('button')
  readAll.textContent = '🔊 Read all'
  readAll.style.cssText = 'border:1px solid rgba(255,255,255,0.25);background:rgba(30,30,34,0.9);color:#fff;' +
    'padding:6px 12px;border-radius:999px;cursor:pointer;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,0.4);'
  var stopAll = document.createElement('button')
  stopAll.textContent = '⏹'
  stopAll.style.cssText = readAll.style.cssText + 'padding:6px 10px;'
  readAll.addEventListener('click', function () {
    var parts = []
    document.querySelectorAll('.gdc-tts-btn').forEach(function (b) {
      var t = (b.parentElement ? b.parentElement.innerText : '').trim()
      if (t) parts.push(t)
    })
    if (parts.length) speak(parts.join('. '), null)
  })
  stopAll.addEventListener('click', function () {
    try { window.speechSynthesis.cancel() } catch (e) {}
  })
  bar.appendChild(readAll)
  bar.appendChild(stopAll)
  document.body.appendChild(bar)

  var mo = new MutationObserver(function () { decorate() })
  mo.observe(document.body, { childList: true, subtree: true })
  setInterval(decorate, 1200)
  decorate()
})()
`
