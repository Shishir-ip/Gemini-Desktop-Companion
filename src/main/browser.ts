import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { log } from './logger'

/**
 * Default-browser helpers. Edge ships with every Windows 10/11 install;
 * Chrome is the fallback. Used for the browser-native Lens popup.
 */

const BROWSER_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(app.getPath('home'), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe')
]

export function findBrowser(): string | null {
  for (const p of BROWSER_CANDIDATES) {
    try {
      if (existsSync(p)) return p
    } catch {
      /* continue */
    }
  }
  return null
}

/**
 * Open Google Lens results for a cropped image as a STANDALONE popup window
 * in the user's real browser — the exact mechanism the reporter's working
 * CTS Extension used (browser-native multipart form POST → full results,
 * no bot walls), but as its own window instead of a merged tab.
 */
export function openLensPopup(cropDataUrl: string): boolean {
  const browserPath = findBrowser()
  const b64 = cropDataUrl.replace(/^data:image\/\w+;base64,/, '')
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
  try {
    writeFileSync(file, html, 'utf8')
  } catch (err) {
    log(`[lens] failed to write upload page: ${String(err)}`)
    return false
  }
  const fileUrl = 'file:///' + file.replace(/\\/g, '/')

  if (browserPath) {
    try {
      // --app opens a clean standalone window (no tab merging into the
      // user's existing browser session).
      const proc: ChildProcess = spawn(
        browserPath,
        [`--app=${fileUrl}`, '--window-size=560,760'],
        { stdio: 'ignore', detached: true }
      )
      proc.unref()
      log('[lens] Lens popup window launched')
      return true
    } catch (err) {
      log(`[lens] browser spawn failed: ${String(err)}`)
    }
  }

  // Fallback: default browser (may merge as a tab — still functional).
  void shell.openExternal(fileUrl)
  log('[lens] Lens page opened via default browser (fallback)')
  return true
}
