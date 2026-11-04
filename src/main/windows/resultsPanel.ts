import { BrowserWindow } from 'electron'
import type { Display, Rectangle } from 'electron'
import { shell, app } from 'electron'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { animateWindowBounds } from '../animate'
import { loadRendererPage, preloadPath } from '../paths'
import { log } from '../logger'

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
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  panel.setAlwaysOnTop(true, 'screen-saver')
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
  panel.on('closed', () => {
    panel = null
  })

  // Auto-open the Google Lens results tab in the user's default browser —
  // instant, quota-independent, and no extra click (the extension's proven
  // browser-native form POST). The panel streams the Gemini analysis alongside.
  void openLensInBrowser()

  loadRendererPage(panel, 'results')
  panel.once('ready-to-show', () => {
    if (!panel || panel.isDestroyed()) return
    panel.show()
    animateWindowBounds(panel, start, target, 240)
  })
}

/**
 * Open the Google Lens results for the stored crop in the USER'S DEFAULT
 * BROWSER — the embedded panel gets served an empty shell by Google's bot
 * detection, while the real browser always returns full results.
/**
 * Open Google Lens for the stored crop using the PROVEN logic from the
 * reporter's working extension: a small local HTML page (opened in the
 * USER'S DEFAULT BROWSER) auto-submits a native multipart form to
 * lens.google.com/upload. The request carries the user's real browser
 * cookies + fingerprint, so Google always serves full results — no bot
 * walls, exactly like the CTS Extension.
 */
export async function openLensInBrowser(): Promise<boolean> {
  if (!lastCrop) return false
  const b64 = lastCrop.replace(/^data:image\/\w+;base64,/, '')
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
  await shell.openExternal('file:///' + file.replace(/\\/g, '/'))
  log('[results] native Lens form opened in default browser')
  return true
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


