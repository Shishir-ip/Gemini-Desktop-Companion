import { desktopCapturer, screen } from 'electron'
import type { Display } from 'electron'
import { log } from './logger'

export interface DisplayCapture {
  dataUrl: string
  scaleFactor: number
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
 * Capture a frozen screenshot of every connected display at native
 * resolution (physical pixels, i.e. logical size × scale factor).
 */
export async function captureAllDisplays(): Promise<Map<number, DisplayCapture>> {
  const displays = screen.getAllDisplays()
  const result = new Map<number, DisplayCapture>()
  const sources = await withTimeout(
    desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: largestThumbnailSize(displays)
    }),
    6000,
    'desktopCapturer.getSources'
  )
  log(`[capture] ${sources.length} screen source(s) for ${displays.length} display(s)`)

  displays.forEach((display, index) => {
    const source = pickSource(sources, display, index)
    if (source && !source.thumbnail.isEmpty()) {
      result.set(display.id, {
        dataUrl: source.thumbnail.toDataURL(),
        scaleFactor: display.scaleFactor
      })
    }
  })
  if (result.size === 0) log('[capture] no usable captures produced')
  return result
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
