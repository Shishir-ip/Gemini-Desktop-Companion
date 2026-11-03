import { net } from 'electron'

export type LensResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * Upload a cropped screenshot to Google Lens and resolve to a results URL.
 *
 * Primary endpoint:  POST https://lens.google.com/upload   (multipart form)
 * Fallback endpoint: POST https://www.google.com/searchbyimage/upload
 */
export async function searchLens(dataUrl: string): Promise<LensResult> {
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')

  try {
    const form = new FormData()
    form.append('encoded_image', new Blob([buffer], { type: 'image/png' }), 'capture.png')
    form.append('hl', 'en')
    const res = await net.fetch('https://lens.google.com/upload', {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20_000)
    })
    if (res.ok) {
      const html = await res.text()
      const url = extractLensUrl(html)
      if (url) return { ok: true, url }
    }
    console.error('[lens] primary endpoint returned', res.status)
  } catch (err) {
    console.error('[lens] primary upload failed:', err)
  }

  try {
    const form = new FormData()
    form.append('encoded_image', new Blob([buffer], { type: 'image/png' }), 'capture.png')
    const res = await net.fetch('https://www.google.com/searchbyimage/upload', {
      method: 'POST',
      body: form,
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000)
    })
    if (res.ok && /^https:\/\/(www\.)?google\./.test(res.url)) {
      return { ok: true, url: res.url }
    }
    console.error('[lens] fallback endpoint returned', res.status, res.url)
  } catch (err) {
    console.error('[lens] fallback upload failed:', err)
  }

  return { ok: false, error: 'LENS_UPLOAD_FAILED' }
}

function extractLensUrl(html: string): string | null {
  const match =
    html.match(/https:\/\/lens\.google\.com\/v2\/[^"'\\\s]+/i) ??
    html.match(/https:\/\/www\.google\.com\/search[^"'\\\s]*tbs=sbi:[^"'\\\s]+/i)
  if (!match) return null
  return match[0]
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
}
