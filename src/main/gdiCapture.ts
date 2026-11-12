import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { nativeImage } from 'electron'
import type { NativeImage, Rectangle } from 'electron'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { log } from './logger'

/**
 * Fast Windows screen capture via GDI (CopyFromScreen) in a persistent
 * PowerShell runspace.
 *
 * WHY: desktopCapturer.getSources takes 3-6 SECONDS on many Windows machines
 * (the enumeration itself, regardless of thumbnail size) — the exact "circle
 * to search takes 4-5s to open" report. GDI captures the same pixels in
 * ~150-250ms.
 *
 * CLEANLINESS: GDI does NOT honor WDA_EXCLUDEFROMCAPTURE, so callers must
 * capture BEFORE showing any overlay window. At ~250ms total that is still
 * an instant-feeling wake, and the frame is guaranteed free of overlay UI.
 *
 * The runspace is spawned once at startup; each capture is a single JSON
 * line on stdin answered by a single line on stdout (no process startup
 * cost per hotkey press).
 */

const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
try {
  Add-Type -Namespace Gdc -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);'
  [Gdc.Dpi]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
} catch {}
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $req = $line | ConvertFrom-Json
    $vs = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $vs.Width, $vs.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($vs.X, $vs.Y, 0, 0, (New-Object System.Drawing.Size $vs.Width, $vs.Height))
    $g.Dispose()
    $bmp.Save($req.out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    [Console]::Out.WriteLine('OK ' + $vs.X + ' ' + $vs.Y + ' ' + $vs.Width + ' ' + $vs.Height)
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine('ERR ' + $_.Exception.Message)
    [Console]::Out.Flush()
  }
}
`

interface GdiShot {
  image: NativeImage
  /** Virtual-screen origin + size in PHYSICAL pixels. */
  virtual: Rectangle
}

let child: ChildProcessWithoutNullStreams | null = null
let ready = false
let failed = false
let buffer = ''
/** Resolves the pending capture (one at a time — captures are serialized). */
let pending: { resolve: (v: GdiShot | null) => void; timer: NodeJS.Timeout } | null = null
const outFile = path.join(tmpdir(), `gdc-capture-${process.pid}.png`)

/** Spawn the persistent capture runspace (call once at startup). */
export function initGdiCapture(): void {
  if (child || failed) return
  const exe = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
  )
  try {
    // The loop script is an ARGUMENT (not stdin): `-Command -` would consume
    // stdin as script text and starve the data protocol.
    child = spawn(exe, ['-NoProfile', '-NonInteractive', '-Command', HELPER_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
  } catch (err) {
    log(`[gdi] spawn failed: ${String(err)} — desktopCapturer fallback will be used`)
    failed = true
    return
  }
  child.on('error', (err) => {
    log(`[gdi] helper error: ${String(err)}`)
    fail()
  })
  child.on('exit', (code) => {
    if (!failed) log(`[gdi] helper exited (${code})`)
    fail()
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk
    let idx: number
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      handleLine(line)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    const text = chunk.trim()
    if (text) log(`[gdi] stderr: ${text.slice(0, 200)}`)
  })
  child.stdin.on('error', () => fail())
}

function handleLine(line: string): void {
  log(`[gdi] line: ${line.slice(0, 160)}`)
  if (line === 'READY') {
    ready = true
    log('[gdi] capture runspace ready')
    return
  }
  if (!pending) return
  const { resolve, timer } = pending
  pending = null
  clearTimeout(timer)
  if (line.startsWith('OK ')) {
    const [, x, y, w, h] = line.split(/\s+/)
    try {
      const image = nativeImage.createFromPath(outFile)
      if (image.isEmpty()) {
        log(`[gdi] PNG empty at ${outFile}`)
        resolve(null)
        return
      }
      resolve({
        image,
        virtual: {
          x: Number(x),
          y: Number(y),
          width: Number(w),
          height: Number(h)
        }
      })
    } catch (err) {
      log(`[gdi] PNG read failed: ${String(err)}`)
      resolve(null)
    }
  } else {
    log(`[gdi] capture failed: ${line.slice(0, 160)}`)
    resolve(null)
  }
}

function fail(): void {
  failed = true
  ready = false
  if (pending) {
    clearTimeout(pending.timer)
    pending.resolve(null)
    pending = null
  }
  child = null
}

export function gdiAvailable(): boolean {
  return ready && !failed && !!child
}

/**
 * Capture the whole virtual screen in ~150-250ms. Returns null when the
 * helper is unavailable — callers fall back to desktopCapturer.
 */
export function captureVirtualScreen(timeoutMs = 3500): Promise<GdiShot | null> {
  if (!gdiAvailable() || pending) return Promise.resolve(null)
  return new Promise<GdiShot | null>((resolve) => {
    const timer = setTimeout(() => {
      log('[gdi] capture timed out')
      if (pending) {
        pending = null
        resolve(null)
      }
    }, timeoutMs)
    pending = { resolve, timer }
    try {
      const req = JSON.stringify({ out: outFile }) + '\n'
      child!.stdin.write(req)
      log(`[gdi] request sent: ${req.trim()}`)
    } catch (err) {
      log(`[gdi] stdin write failed: ${String(err)}`)
      clearTimeout(timer)
      pending = null
      resolve(null)
    }
  })
}

/** Crop one display out of a virtual-screen shot (physical pixels). */
export function cropDisplay(shot: GdiShot, display: Electron.Display): NativeImage | null {
  const sf = display.scaleFactor
  const x = Math.round(display.bounds.x * sf) - shot.virtual.x
  const y = Math.round(display.bounds.y * sf) - shot.virtual.y
  const width = Math.round(display.size.width * sf)
  const height = Math.round(display.size.height * sf)
  const size = shot.image.getSize()
  if (x < 0 || y < 0 || x + width > size.width || y + height > size.height) {
    // Mixed-DPI edge case: fall back to a clamped crop.
    const cx = Math.max(0, Math.min(x, size.width - 2))
    const cy = Math.max(0, Math.min(y, size.height - 2))
    const cw = Math.min(width, size.width - cx)
    const ch = Math.min(height, size.height - cy)
    if (cw <= 2 || ch <= 2) return null
    return shot.image.crop({ x: cx, y: cy, width: cw, height: ch })
  }
  return shot.image.crop({ x, y, width, height })
}

/** Kill the runspace on app quit. */
export function destroyGdiCapture(): void {
  if (child) {
    try {
      child.stdin.end()
      child.kill()
    } catch {
      /* already gone */
    }
    child = null
  }
  ready = false
}