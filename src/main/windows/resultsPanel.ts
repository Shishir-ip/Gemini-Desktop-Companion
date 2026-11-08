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
<html><body style="background:#101014;color:#eee;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div id="msg">Opening Google Lens…</div>
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

/** Inject the floating status bar into the Google results page. */
function injectStatusBar(win: BrowserWindow, empty: boolean): void {
  const css = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);z-index:2147483647;' +
    'display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:999px;' +
    'background:rgba(18,18,22,0.92);border:1px solid rgba(255,255,255,0.18);color:#eee;' +
    'font-family:system-ui,sans-serif;font-size:12px;box-shadow:0 8px 26px rgba(0,0,0,0.5);'
  const btn = 'border:1px solid rgba(255,255,255,0.28);background:rgba(255,255,255,0.1);color:#fff;' +
    'padding:4px 12px;border-radius:999px;cursor:pointer;font-size:12px;font-family:inherit;'
  const bar = empty
    ? `<span>Lens looks empty</span>` +
      `<button id="gdc-retry" style="${btn}">Retry</button>` +
      `<button id="gdc-browser" style="${btn}">Open in browser</button>`
    : `<span style="opacity:0.85">Google Lens</span>`
  const script = `
    (function () {
      document.getElementById('gdc-bar')?.remove()
      var bar = document.createElement('div')
      bar.id = 'gdc-bar'
      bar.style.cssText = ${JSON.stringify(css)}
      bar.innerHTML = ${JSON.stringify(bar)}
      document.body.appendChild(bar)
      var retry = document.getElementById('gdc-retry')
      if (retry) retry.addEventListener('click', function () {
        try { window.gdc.lens.analyze() } catch (e) {}
        bar.remove()
      })
      var open = document.getElementById('gdc-browser')
      if (open) open.addEventListener('click', function () {
        try { window.gdc.lens.openWeb() } catch (e) {}
      })
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
