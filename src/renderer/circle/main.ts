import type { CircleMode } from '../../shared/types'

/**
 * Circle to Search overlay:
 *  1. paints the frozen screenshot pixel-perfectly,
 *  2. captures a drag rectangle,
 *  3. crops it at native resolution and hands it to the main process.
 */

const img = document.getElementById('shot') as HTMLImageElement
const dim = document.getElementById('dim') as HTMLDivElement
const sel = document.getElementById('sel') as HTMLDivElement
const selBox = document.getElementById('sel-box') as HTMLDivElement
const selBadge = document.getElementById('sel-badge') as HTMLDivElement
const hintText = document.getElementById('hint-text') as HTMLElement
const attachHint = document.getElementById('attach-hint') as HTMLElement

let mode: CircleMode = 'lens'
let lensMode = false
let scaleFactor = 1
let dragging = false
let moved = false
let startX = 0
let startY = 0

init().catch((err) => {
  console.error('circle init failed', err)
  void window.gdc.circle.cancel()
})

async function init(): Promise<void> {
  const capture = await window.gdc.circle.getCapture()
  if (!capture) {
    void window.gdc.circle.cancel()
    return
  }
  mode = capture.mode
  scaleFactor = capture.scaleFactor

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('screenshot decode failed'))
    img.src = capture.dataUrl
  })

  // Mode-specific instructions — the #1 complaint was not knowing to drag.
  if (mode === 'attach') {
    hintText.textContent = 'Drag over the region to attach'
    attachHint.hidden = false
  }

  // Paint one frame, then tell the main process we're alive and interactive
  // (clears its dead-renderer watchdog).
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  window.gdc.circle.ready()

  window.gdc.circle.onSetLensMode(() => {
    lensMode = true
    document.body.classList.add('lens-mode')
    selBox.style.display = 'none'
    selBadge.hidden = true
  })
}

/* ── Esc handling ──────────────────────────────────────────────────────── */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    if (dragging) {
      // Mid-drag: abandon the current selection but keep the overlay up.
      resetSelection()
    } else {
      // Spec: Esc dismisses the whole Circle to Search experience instantly.
      void window.gdc.circle.dismissAll()
    }
  }
})

/* ── Selection drag ────────────────────────────────────────────────────── */
sel.addEventListener('pointerdown', (e) => {
  if (lensMode) {
    // Any click on the frozen screen while results are open dismisses all.
    void window.gdc.circle.dismissAll()
    return
  }
  if (e.button !== 0) return
  dragging = true
  moved = false
  startX = e.clientX
  startY = e.clientY
  try {
    sel.setPointerCapture(e.pointerId)
  } catch {
    /* pointer may already be gone */
  }
  selBox.style.display = 'block'
  updateBox(e.clientX, e.clientY)
})

sel.addEventListener('pointermove', (e) => {
  if (!dragging) return
  if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) moved = true
  updateBox(e.clientX, e.clientY)
})

// A cancelled pointer (gesture takeover, device switch) must not leave a
// half-dead drag state behind.
sel.addEventListener('pointercancel', () => {
  dragging = false
  resetSelection()
})

// Right-click must never open a menu over the frozen screen.
window.addEventListener('contextmenu', (e) => e.preventDefault())

sel.addEventListener('pointerup', (e) => {
  if (!dragging) return
  dragging = false
  const rect = normalizedRect(e.clientX, e.clientY)

  if (!moved) {
    // A plain click (no drag):
    //  - attach mode → attach the entire screen (most forgiving default)
    //  - lens mode   → treat as a dismiss
    if (mode === 'attach') {
      void submitCrop({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
    } else {
      void window.gdc.circle.dismissAll()
    }
    return
  }

  if (rect.width < 10 || rect.height < 10) {
    resetSelection()
    return
  }
  void submitCrop(rect)
})

function updateBox(x: number, y: number): void {
  const rect = normalizedRect(x, y)
  selBox.style.left = `${rect.x}px`
  selBox.style.top = `${rect.y}px`
  selBox.style.width = `${rect.width}px`
  selBox.style.height = `${rect.height}px`
  selBadge.hidden = false
  selBadge.textContent = `${Math.round(rect.width * scaleFactor)} × ${Math.round(
    rect.height * scaleFactor
  )} px`
  selBadge.style.left = `${rect.x}px`
  selBadge.style.top = `${rect.y + rect.height}px`
}

function normalizedRect(x: number, y: number): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(startX, x),
    y: Math.min(startY, y),
    width: Math.abs(x - startX),
    height: Math.abs(y - startY)
  }
}

function resetSelection(): void {
  selBox.style.display = 'none'
  selBadge.hidden = true
  dim.style.background = 'rgba(0, 0, 0, 0.34)'
}

/** Crop the frozen screenshot at physical-pixel resolution and send it up. */
async function submitCrop(rect: {
  x: number
  y: number
  width: number
  height: number
}): Promise<void> {
  try {
    const sx = Math.max(0, Math.round(rect.x * scaleFactor))
    const sy = Math.max(0, Math.round(rect.y * scaleFactor))
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * scaleFactor))
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * scaleFactor))
    if (sw <= 2 || sh <= 2) {
      resetSelection()
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
    const dataUrl = canvas.toDataURL('image/png')

    selBox.style.display = 'none'
    selBadge.hidden = true
    await window.gdc.circle.selectFinished(dataUrl)
    // In 'attach' mode the main process closed this overlay already; in
    // 'lens' mode it switched us to lens-mode via the event.
  } catch (err) {
    console.error('crop failed', err)
    resetSelection()
  }
}
