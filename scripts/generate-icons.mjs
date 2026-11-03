/**
 * Gemini Desktop Companion — procedural icon generator (zero dependencies).
 *
 * Draws the app icon (iOS-style rounded square with a diagonal blue→violet
 * gradient and a Gemini-style four-point sparkle) and encodes it straight to
 * PNG + multi-size ICO using Node's zlib. Also generates the tray sparkle.
 *
 * Outputs:
 *   build/icon.ico                 (256/128/64/48/32/16)
 *   build/icon.png                 (512)
 *   resources/tray.png             (32, sparkle only)
 *   src/renderer/public/icon.png   (256, used in UI headers)
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Signed distance to a rounded rectangle. */
function roundedRectSDF(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r)
  const qy = Math.abs(py - cy) - (hh - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

/** Coverage of a four-point "sparkle" (astroid: |x|^(2/3)+|y|^(2/3) <= 1). */
function starCoverage(px, py, cx, cy, r) {
  const nx = Math.abs(px - cx) / r
  const ny = Math.abs(py - cy) / r
  if (nx === 0 && ny === 0) return 1
  const v = Math.pow(nx, 2 / 3) + Math.pow(ny, 2 / 3)
  return clamp01(1 - v)
}

const mix = (a, b, t) => a + (b - a) * t

/** Render the full app icon at `size` px with 3x supersampling. */
function renderIcon(size) {
  const ss = 3
  const S = size * ss
  const buf = Buffer.alloc(S * S * 4)
  const half = S / 2
  const radius = S * 0.225
  const c1 = [91, 141, 255] // #5B8DFF
  const c2 = [168, 85, 247] // #A855F7

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const sd = roundedRectSDF(px, py, half, half, half - 1, half - 1, radius)
      const cov = clamp01(0.5 - sd)
      if (cov <= 0) continue

      // Diagonal gradient
      const t = clamp01((px + py) / (2 * S))
      let r = mix(c1[0], c2[0], t)
      let g = mix(c1[1], c2[1], t)
      let b = mix(c1[2], c2[2], t)

      // Soft top-left highlight
      const d = Math.hypot(px - S * 0.28, py - S * 0.22) / (S * 0.95)
      const hl = clamp01(1 - d) * 0.22
      r = mix(r, 255, hl)
      g = mix(g, 255, hl)
      b = mix(b, 255, hl)

      // Gemini-style sparkles (big center + small top-right)
      const big = starCoverage(px, py, half, half * 1.04, S * 0.30)
      const small = starCoverage(px, py, S * 0.70, S * 0.30, S * 0.085)
      const star = Math.min(1, big + small)
      r = mix(r, 255, star)
      g = mix(g, 255, star)
      b = mix(b, 255, star)

      // Inner 1px light border (iOS glass rim)
      const rim = clamp01(1 - Math.abs(sd + 1.8) / 1.6) * 0.30
      r = mix(r, 255, rim)
      g = mix(g, 255, rim)
      b = mix(b, 255, rim)

      const i = (y * S + x) * 4
      buf[i] = r
      buf[i + 1] = g
      buf[i + 2] = b
      buf[i + 3] = cov * 255
    }
  }
  return downsample(buf, S, ss)
}

/** Render the tray sparkle (white-blue star, transparent background). */
function renderTray(size) {
  const ss = 4
  const S = size * ss
  const buf = Buffer.alloc(S * S * 4)
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5
      const py = y + 0.5
      const big = starCoverage(px, py, S / 2, S * 0.54, S * 0.36)
      const small = starCoverage(px, py, S * 0.76, S * 0.22, S * 0.10)
      const cov = Math.min(1, big + small)
      if (cov <= 0) continue
      const t = clamp01(py / S)
      const i = (y * S + x) * 4
      buf[i] = mix(240, 205, t)
      buf[i + 1] = mix(244, 218, t)
      buf[i + 2] = mix(255, 255, t)
      buf[i + 3] = cov * 255
    }
  }
  return downsample(buf, S, ss)
}

/** Box-downsample an RGBA buffer by an integer factor. */
function downsample(src, S, ss) {
  const size = S / ss
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const i = ((y * ss + dy) * S + (x * ss + dx)) * 4
          const al = src[i + 3]
          r += src[i] * al
          g += src[i + 1] * al
          b += src[i + 2] * al
          a += al
        }
      }
      const j = (y * size + x) * 4
      if (a > 0) {
        out[j] = r / a
        out[j + 1] = g / a
        out[j + 2] = b / a
      }
      out[j + 3] = a / (ss * ss)
    }
  }
  return out
}

// ---------------------------------------------------------------- PNG / ICO

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const stride = size * 4
  const raw = Buffer.alloc(size * (stride + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

function encodeICO(items) {
  const count = items.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const entries = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  const blobs = []
  items.forEach((item, idx) => {
    const e = idx * 16
    entries[e] = item.size >= 256 ? 0 : item.size
    entries[e + 1] = item.size >= 256 ? 0 : item.size
    entries[e + 4] = 1 // planes
    entries.writeUInt16LE(32, e + 6) // bpp
    entries.writeUInt32LE(item.png.length, e + 8)
    entries.writeUInt32LE(offset, e + 12)
    offset += item.png.length
    blobs.push(item.png)
  })
  return Buffer.concat([header, entries, ...blobs])
}

// -------------------------------------------------------------------- main

mkdirSync(join(root, 'build'), { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })
mkdirSync(join(root, 'src', 'renderer', 'public'), { recursive: true })

writeFileSync(join(root, 'build', 'icon.png'), encodePNG(renderIcon(512), 512))
writeFileSync(
  join(root, 'build', 'icon.ico'),
  encodeICO([256, 128, 64, 48, 32, 16].map((s) => ({ size: s, png: encodePNG(renderIcon(s), s) })))
)
writeFileSync(join(root, 'resources', 'tray.png'), encodePNG(renderTray(32), 32))
writeFileSync(join(root, 'src', 'renderer', 'public', 'icon.png'), encodePNG(renderIcon(256), 256))

console.log('[icons] generated build/icon.ico, build/icon.png, resources/tray.png, src/renderer/public/icon.png')
