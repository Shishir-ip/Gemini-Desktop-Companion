import https from 'node:https'

export type LensResult = { ok: true; url: string } | { ok: false; error: string }

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

/**
 * Ground truth (verified live): POST https://lens.google.com/upload answers
 * 302 with the results URL in `Location` — a
 * www.google.com/search?vsrid=…&udm=26 page. Implemented with raw node:https
 * because Electron's net.fetch routes through the system proxy, which breaks
 * the upload on proxied machines (the exact "Couldn't reach Google Lens"
 * report), and node:https connects directly — identical to our verified curl
 * reproduction.
 */

function multipartBody(buffer: Buffer): { body: Buffer; contentType: string } {
  const boundary = `----gdc${Date.now()}${Math.floor(Math.random() * 1e6)}`
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="encoded_image"; filename="capture.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`
  const middle = `\r\n--${boundary}\r\n` +
    `Content-Disposition: form-data; name="hl"\r\n\r\nen\r\n`
  const tail = `--${boundary}--\r\n`
  const body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    buffer,
    Buffer.from(middle, 'utf8'),
    Buffer.from(tail, 'utf8')
  ])
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

function post(
  host: string,
  path: string,
  body: Buffer,
  contentType: string
): Promise<{ status: number; location: string | null; resUrl: string | null; body: string | null }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path,
        method: 'POST',
        headers: {
          'User-Agent': CHROME_UA,
          'Content-Type': contentType,
          'Content-Length': body.length,
          Accept: 'text/html,application/xhtml+xml'
        },
        timeout: 20_000
      },
      (res) => {
        const chunks: Buffer[] = []
        // Only buffer the body when we actually need to scrape it.
        if (res.statusCode && res.statusCode < 300) {
          res.on('data', (c: Buffer) => {
            chunks.push(c)
            if (chunks.reduce((n, x) => n + x.length, 0) > 512 * 1024) res.destroy()
          })
        } else {
          res.resume()
        }
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            resUrl: res.url ?? null,
            body: chunks.length ? Buffer.concat(chunks).toString('utf8') : null
          })
        })
      }
    )
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('timeout'))
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

function isLensResultsUrl(url: string): boolean {
  return /vsrid=|udm=26|lens\.google\.com\/v\d|tbs=sbi:|searchbyimage/i.test(url)
}

function extractLensUrl(html: string): string | null {
  const match =
    html.match(/https:\/\/lens\.google\.com\/v\d\/[^"'\\\s]+/i) ??
    html.match(/https:\/\/www\.google\.com\/search[^"'\\\s]*(?:vsrid=|tbs=sbi:)[^"'\\\s]*/i)
  if (!match) return null
  return match[0]
    .replace(/\\u003d/g, '=')
    .replace(/\\u0026/g, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
}

/** Upload a cropped screenshot to Google Lens and resolve to a results URL. */
export async function searchLens(dataUrl: string): Promise<LensResult> {
  const buffer = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ''), 'base64')
  const { body, contentType } = multipartBody(buffer)

  // Primary: lens.google.com/upload → 302 Location
  try {
    const res = await post('lens.google.com', '/upload', body, contentType)
    if (res.location && isLensResultsUrl(res.location)) {
      return { ok: true, url: res.location }
    }
    if (res.body) {
      const url = extractLensUrl(res.body)
      if (url) return { ok: true, url }
    }
    console.error('[lens] primary endpoint returned', res.status, res.location?.slice(0, 80))
  } catch (err) {
    console.error('[lens] primary upload failed:', err)
  }

  // Fallback: searchbyimage upload → 302 Location
  try {
    const res = await post('www.google.com', '/searchbyimage/upload', body, contentType)
    if (res.location && isLensResultsUrl(res.location)) {
      return { ok: true, url: res.location }
    }
    if (res.body) {
      const url = extractLensUrl(res.body)
      if (url) return { ok: true, url }
    }
    console.error('[lens] fallback endpoint returned', res.status, res.location?.slice(0, 80))
  } catch (err) {
    console.error('[lens] fallback upload failed:', err)
  }

  return { ok: false, error: 'LENS_UPLOAD_FAILED' }
}
