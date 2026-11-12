import { desktopCapturer, screen } from 'electron'
import type { Display, NativeImage } from 'electron'
import { captureVirtualScreen, cropDisplay, gdiAvailable } from './gdiCapture'
import { log } from './logger'

export interface DisplayCapture {
  /** Lossless original — every crop is cut from THIS, never from the UI. */
  image: NativeImage
  /** Fast JPEG preview for the overlay display (small + quick to decode). */
  previewUrl: string
  scaleFactor: number
}

function toPreview(image: NativeImage): string {
  // q92 JPEG: visually identical for a frozen preview, ~10× faster to
  // encode than PNG and much faster for the renderer to decode.
  return 'data:image/jpeg;base64,' + image.toJPEG(92).toString('base64')
}

/** Reject a promise if it takes longer than `ms`. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ])
}

/**
 * Initialize the OS capture pipeline once at startup (fallback path only).
 * The FIRST desktopCapturer call pays a heavy initialization cost; doing it
 * here, invisibly, makes a later fallback capture faster.
 */
export async function warmupCapturer(): Promise<void> {
  try {
    await withTimeout(
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } }),
      8000,
      'capture warmup'
    )
    log('[capture] desktopCapturer fallback warmed up')
  } catch (err) {
    log(`[capture] warmup failed: ${String(err)}`)
  }
}

/**
 * Capture a frozen screenshot of every connected display at native
 * resolution (physical pixels).
 *
 * FAST PATH: GDI CopyFromScreen via the persistent helper (~150-250ms).
 * Callers must run this BEFORE showing overlay windows — GDI does not honor
 * capture-exclusion, so nothing of ours may be on screen yet.
 *
 * FALLBACK: desktopCapturer (slow on some machines, but honors
 * WDA_EXCLUDEFROMCAPTURE, so overlays may already be up).
 */
export async function captureAllDisplays(): Promise<Map<number, DisplayCapture>> {
  const displays = screen.getAllDisplays()
  const result = new Map<number, DisplayCapture>()

  if (gdiAvailable()) {
    const t0 = Date.now()
    const shot = await captureVirtualScreen()
    if (shot) {
      for (const display of displays) {
        const image = cropDisplay(shot, display)
        if (image && !image.isEmpty()) {
          result.set(display.id, {
            image,
            previewUrl: toPreview(image),
            scaleFactor: display.scaleFactor
          })
        }
      }
      if (result.size > 0) {
        log(`[capture] GDI: ${result.size} display(s) in ${Date.now() - t0}ms`)
        return result
      }
    }
    log('[capture] GDI unavailable/failed — falling back to desktopCapturer')
  }

  const t0 = Date.now()
  const sources = await withTimeout(
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: largestThumbnailSize(displays)
    }),
    9000,
    'desktopCapturer.getSources'
  )
  log(`[capture] desktopCapturer: ${sources.length} source(s) in ${Date.now() - t0}ms`)

  displays.forEach((display, index) => {
    const source = pickSource(sources, display, index)
    if (source && !source.thumbnail.isEmpty()) {
      const image = source.thumbnail
      result.set(display.id, {
        image,
        previewUrl: toPreview(image),
        scaleFactor: display.scaleFactor
      })
    }
  })
  if (result.size === 0) log('[capture] no usable captures produced')
  return result
}

/**
 * Crop a selection (logical CSS pixels) out of the lossless original at
 * physical-pixel resolution. Runs in MAIN so the delivered image can never
 * contain the overlay, the dim, or the selection UI.
 */
export function cropCapture(
  capture: DisplayCapture,
  rect: { x: number; y: number; width: number; height: number }
): string | null {
  const { image, scaleFactor } = capture
  const size = image.getSize()
  const sx = Math.max(0, Math.round(rect.x * scaleFactor))
  const sy = Math.max(0, Math.round(rect.y * scaleFactor))
  const sw = Math.min(size.width - sx, Math.round(rect.width * scaleFactor))
  const sh = Math.min(size.height - sy, Math.round(rect.height * scaleFactor))
  if (sw <= 2 || sh <= 2) return null
  const cropped = image.crop({ x: sx, y: sy, width: sw, height: sh })
  return cropped.toDataURL()
}

function largestThumbnailSize(displays: Display[]): { width: number; height: number } {
  let width = 0
  let height = 0
  for (const d of displays) {
    width = Math.max(width, Math.ceil(d.size.width * d.scaleFactor))
    height = Math.max(height, Math.ceil(d.size.height * d.scaleFactor))
  }
  return { width: Math.max(width, 1280), height: Math.max(height, 720) }
}

function pickSource(
  sources: Electron.DesktopCapturerSource[],
  display: Display,
  index: number
): Electron.DesktopCapturerSource | undefined {
  return (
    sources.find((s) => s.display_id === String(display.id)) ??
    sources.find((s) => s.name.toLowerCase().includes(`screen ${index + 1}`)) ??
    sources[index] ??
    sources[0]
  )
}