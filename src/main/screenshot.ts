import { desktopCapturer, screen } from 'electron'
import type { Display } from 'electron'

export interface DisplayCapture {
  dataUrl: string
  scaleFactor: number
}

/**
 * Capture a frozen screenshot of every connected display at native
 * resolution (physical pixels, i.e. logical size × scale factor).
 */
export async function captureAllDisplays(): Promise<Map<number, DisplayCapture>> {
  const displays = screen.getAllDisplays()
  const result = new Map<number, DisplayCapture>()
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: largestThumbnailSize(displays)
  })

  displays.forEach((display, index) => {
    const source = pickSource(sources, display, index)
    if (source && !source.thumbnail.isEmpty()) {
      result.set(display.id, {
        dataUrl: source.thumbnail.toDataURL(),
        scaleFactor: display.scaleFactor
      })
    }
  })
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
