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
/** True once the frozen frame is painted — selection is gated on this. */
let frozenReady = false

init().catch((err) => {
  console.error('circle init failed', err)
  void window.gdc.circle.cancel()
})

/** Push a dim-only state while desktopCapturer is still running. */
function enterWaiting(m: CircleMode): void {
  mode = m
  frozenReady = false
  lensMode = false
  document.body.classList.remove('lens-mode')
  resetSelection()
  hintText.textContent = 'Capturing screen…'
  attachHint.hidden = true
  document.body.classList.add('ready')
  // Painted (dim + hint) — clear the main-process ready watchdog now.
  window.gdc.circle.ready()
}

function setHints(): void {
  hintText.textContent = 'Drag to select anything on screen'
  attachHint.hidden = true
  if (mode === 'attach') {
    hintText.textContent = 'Drag over the region to attach'
    attachHint.hidden = false
  }
}

async function applyCapture(dataUrl: string, sf: number, m: CircleMode): Promise<void> {
  mode = m
  scaleFactor = sf
  lensMode = false
  document.body.classList.remove('lens-mode')
  resetSelection()
  setHints()
  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve() // Esc still works; main watchdog still armed
    img.src = dataUrl
  })
  frozenReady = true
  // Smooth fade-in of the frozen screen.
  document.body.classList.add('ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  window.gdc.circle.ready()
}

async function init(): Promise<void> {
  // Warm reuse pushes frames through onSetImage — listen BEFORE any await
  // so an early frame can never race this setup.
  window.gdc.circle.onSetImage((payload) => {
    const p = payload as { dataUrl: string | null; scaleFactor: number; mode: CircleMode }
    if (!p.dataUrl) {
      enterWaiting(p.mode)
      return
    }
    void applyCapture(p.dataUrl, p.scaleFactor, p.mode)
  })

  const capture = await window.gdc.circle.getCapture()
  if (capture) {
    await applyCapture(capture.dataUrl, capture.scaleFactor, capture.mode)
  } else {
    // Instant open: the window was shown BEFORE the capture finished —
    // hold the dim until the frozen frame arrives via onSetImage.
    enterWaiting('lens')
  }
}

/* ── Esc handling ──────────────────────────────────────────────────────── */
// Results panel opened → the frozen screen relaxes into "click to dismiss".
window.gdc.circle.onSetLensMode(() => {
  lensMode = true
  document.body.classList.add('lens-mode')
  selBox.style.display = 'none'
  selBadge.hidden = true
})

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
  // No frozen frame yet (still capturing) — a drag now would crop garbage.
  if (!frozenReady) return
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
