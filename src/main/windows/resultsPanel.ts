import { BrowserWindow, ipcMain, screen } from 'electron'
import { writeFileSync } from 'node:fs'
import type { Display, Rectangle } from 'electron'
import { app, shell } from 'electron'
import path from 'node:path'
import { animateWindowBounds } from '../animate'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

/**
 * Circle-to-Search results panel — the reporter's CTS-Extension mechanism:
 *
 * The panel is a real browser surface on the `persist:gemini` session (the
 * user's imported Google cookies). It loads a locally generated
 * auto-submitting form page (exactly like the working extension's
 * upload.html): the browser-native multipart POST carries the user's session
 * cookies and fingerprint, so Google serves FULL Lens results inside the
 * panel. No API upload, no session-less URL loads, no empty shells.
 */

let panel: BrowserWindow | null = null
let lastCrop: string | null = null
let boundEmptyDetection = false

function writeUploadPage(dataUrl: string): string {
  const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '')
  const html = `<!doctype html>
<html><body style="background:#0b0b10;color:#eee;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;gap:18px;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="width:34px;height:34px;border-radius:50%;border:3px solid rgba(126,166,255,0.2);border-top-color:#7ea6ff;animation:gdcspin 0.9s linear infinite"></div>
<div id="msg" style="font-size:13px;opacity:0.85">Opening Google Lens…</div>
<style>@keyframes gdcspin{to{transform:rotate(360deg)}}</style>
<form id="f" method="POST" action="https://lens.google.com/upload" enctype="multipart/form-data">
  <input type="file" name="encoded_image" hidden>
</form>
<script>
  try {
    const b64 = "${b64}";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], "search.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[name="encoded_image"]');
    input.files = dt.files;
    document.getElementById("f").submit();
  } catch (e) {
    document.getElementById("msg").textContent = "Could not open Lens: " + e;
  }
</script>
</body></html>`
  const file = path.join(app.getPath('userData'), 'lens-upload.html')
  writeFileSync(file, html, 'utf8')
  return 'file:///' + file.replace(/\\/g, '/')
}

/** Inject the floating glass toolbar into the Google results page. */
function injectStatusBar(win: BrowserWindow, empty: boolean): void {
  const barCss =
    'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'display:flex;gap:6px;align-items:center;padding:7px 10px;border-radius:16px;' +
    'background:#232428;border:1px solid #43444c;' +
    'box-shadow:0 12px 40px rgba(0,0,0,0.5);' +
    'font-family:system-ui,"Segoe UI",sans-serif;font-size:12px;color:#eee;'
  const btnCss =
    'display:inline-flex;align-items:center;gap:6px;border:1px solid #43444c;' +
    'background:#2a2b30;color:#fff;padding:6px 12px;border-radius:10px;' +
    'cursor:pointer;font-size:12px;font-family:inherit;font-weight:500;' +
    'transition:background 150ms ease,transform 150ms ease;'
  const primaryCss =
    'display:inline-flex;align-items:center;gap:6px;border:1px solid #5b77c4;' +
    'background:#5b77c4;color:#fff;padding:6px 12px;' +
    'border-radius:10px;cursor:pointer;font-size:12px;font-family:inherit;font-weight:600;' +
    'transition:filter 150ms ease,transform 150ms ease;'
  const labelCss = 'opacity:0.75;padding:0 4px;white-space:nowrap;'
  const script = `
    (function () {
      document.getElementById('gdc-bar')?.remove()
      var bar = document.createElement('div')
      bar.id = 'gdc-bar'
      bar.style.cssText = ${JSON.stringify(barCss)}
      var btnCss = ${JSON.stringify(btnCss)}
      var primaryCss = ${JSON.stringify(primaryCss)}
      function mk(id, label, primary) {
        var b = document.createElement('button')
        b.id = id
        b.textContent = label
        b.style.cssText = primary ? primaryCss : btnCss
        b.addEventListener('mouseenter', function () {
          b.style.background = primary ? '#6b87d4' : '#313238'
          b.style.transform = 'translateY(-1px)'
        })
        b.addEventListener('mouseleave', function () {
          b.style.background = primary ? '#5b77c4' : '#2a2b30'
          b.style.transform = ''
        })
        bar.appendChild(b)
        return b
      }
      var label = document.createElement('span')
      label.style.cssText = ${JSON.stringify(labelCss)}
      label.textContent = ${JSON.stringify(empty ? 'Lens looks empty —' : 'Google Lens')}
      bar.appendChild(label)
      var ask = mk('gdc-ask', '✦ Ask Gemini', true)
      var copy = mk('gdc-copy', 'Copy')
      var save = mk('gdc-save', 'Save')
      var retry = mk('gdc-retry', 'Retry')
      var web = mk('gdc-browser', 'Browser')
      var close = mk('gdc-close', '✕')
      close.title = 'Close (Esc)'
      function flash(b, text) {
        var old = b.textContent
        b.textContent = text
        setTimeout(function () { b.textContent = old }, 1400)
      }
      ask.addEventListener('click', function () { try { window.gdc.lens.askGemini() } catch (e) {} })
      copy.addEventListener('click', function () {
        try { window.gdc.lens.copyImage().then(function (r) { flash(copy, r && r.ok ? '✓ Copied' : 'Failed') }) } catch (e) {}
      })
      save.addEventListener('click', function () {
        try { window.gdc.lens.saveImage().then(function (r) { flash(save, r && r.ok ? '✓ Saved' : 'Cancelled') }) } catch (e) {}
      })
      retry.addEventListener('click', function () { try { window.gdc.lens.analyze() } catch (e) {} bar.remove() })
      web.addEventListener('click', function () { try { window.gdc.lens.openWeb() } catch (e) {} })
      close.addEventListener('click', function () { try { window.gdc.lens.closePanel() } catch (e) {} })
      document.body.appendChild(bar)
      try {
        bar.animate(
          [{ opacity: 0, transform: 'translateX(-50%) translateY(14px)' },
           { opacity: 1, transform: 'translateX(-50%) translateY(0)' }],
          { duration: 260, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', fill: 'both' }
        )
      } catch (e) {}
    })()
  `
  void win.webContents.executeJavaScript(script).catch(() => {})
}

function onPanelNavigate(win: BrowserWindow): void {
  const url = win.webContents.getURL()
  log(`[lens] panel navigate: ${url.slice(0, 80)}`)
  if (/google\./.test(url)) {
    // Give the results page a moment to render, then check whether it's empty.
    setTimeout(() => {
      if (!win || win.isDestroyed()) return
      void win.webContents
        .executeJavaScript(
          `(document.body.innerText || '').trim().length`
        )
        .then((len) => {
          if (!win || win.isDestroyed()) return
          const empty = typeof len === 'number' && len < 60
          log(`[lens] results page text length: ${len} (${empty ? 'EMPTY' : 'ok'})`)
          injectStatusBar(win, empty)
        })
        .catch(() => {})
    }, 5000)
  }
}

/**
 * Open the Circle-to-Search panel: a real browser surface on the user's
 * imported Google session that auto-uploads the crop to Lens.
 */
export function openResultsPanel(display: Display, dataUrl: string): void {
  closePanel(true)
  lastCrop = dataUrl

  const wa = display.workArea
  const margin = 12
  const width = 520
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
      partition: 'persist:gemini',
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
    log(`[lens] panel load failed (${code} ${desc}) — closing search UI`)
    void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
  })
  panel.webContents.on('render-process-gone', (_event, details) => {
    log(`[lens] panel renderer gone (${details.reason}) — closing search UI`)
    void import('./overlay').then(({ closeAllSearchUI }) => closeAllSearchUI())
  })
  panel.webContents.on('did-finish-load', () => {
    onPanelNavigate(panel!)
  })
  panel.on('closed', () => {
    panel = null
  })

  // Load the auto-submitting upload page on the user's session — the form
  // POST carries their cookies, and the results render right here.
  try {
    const uploadUrl = writeUploadPage(dataUrl)
    void panel.loadURL(uploadUrl).catch(() => {})
  } catch (err) {
    log(`[lens] upload page write failed: ${String(err)}`)
  }

  panel.once('ready-to-show', () => {
    if (!panel || panel.isDestroyed()) return
    panel.show()
    animateWindowBounds(panel, start, target, 240)
  })
}

export function retryLensInPanelIpc(): boolean {
  return retryLensInPanel()
}

export function getLastCrop(): string | null {
  return lastCrop
}

/** Re-run the Lens upload for the stored crop (Retry button). */
export function retryLensInPanel(): boolean {
  if (!panel || panel.isDestroyed() || !lastCrop) return false
  try {
    const uploadUrl = writeUploadPage(lastCrop)
    void panel.loadURL(uploadUrl).catch(() => {})
    return true
  } catch (err) {
    log(`[lens] retry failed: ${String(err)}`)
    return false
  }
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

/** Wire panel-related IPC (Retry / Open in browser). */
export function bindPanelIpc(): void {
  if (boundEmptyDetection) return
  boundEmptyDetection = true
  // NOTE: 'lens:open-web' is registered in ipc.ts (it calls retryLensInPanel
  // here via the exported wrapper) — do not register it twice.
  ipcMain.handle('lens:analyze', async () => retryLensInPanel())
}
