import type { CapturePayload, CapturePrefs, CircleMode, SelectionRect } from '../../shared/types'
import { DEFAULT_PREFS } from '../../shared/types'

/**
 * Circle to Search overlay:
 *  1. wakes instantly with the Apple-Intelligence rim glow over the LIVE
 *     screen (the window is transparent until the frozen frame arrives),
 *  2. paints the frozen screenshot pixel-perfectly once captured,
 *  3. captures a drag rectangle and hands the RECT to the main process,
 *     which crops the lossless original — the delivered image can never
 *     contain the overlay, the dim, or the selection UI.
 */

const img = document.getElementById('shot') as HTMLImageElement
const sel = document.getElementById('sel') as HTMLDivElement
const selBox = document.getElementById('sel-box') as HTMLDivElement
const selBadge = document.getElementById('sel-badge') as HTMLDivElement
const hintText = document.getElementById('hint-text') as HTMLElement
const hintSpinner = document.getElementById('hint-spinner') as HTMLElement
const attachHint = document.getElementById('attach-hint') as HTMLElement
const flash = document.getElementById('flash') as HTMLDivElement

let mode: CircleMode = 'lens'
let lensMode = false
let scaleFactor = 1
let dragging = false
let moved = false
let startX = 0
let startY = 0
/** True once the frozen frame is painted — selection is gated on this. */
let frozenReady = false
// 1×1 transparent GIF: guarantees the <img> stops displaying the previous
// session's screenshot (Chromium keeps the last decoded bitmap otherwise).
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

init().catch((err) => {
  console.error('circle init failed', err)
  void window.gdc.circle.cancel()
})

/* ── Preferences → body classes ────────────────────────────────────────── */
function applyPrefs(prefs: CapturePrefs): void {
  const b = document.body
  b.classList.toggle('glow-off', !prefs.glow)
  b.classList.remove('glow-subtle', 'glow-balanced', 'glow-vivid')
  b.classList.add(`glow-${prefs.glowIntensity}`)
  b.classList.remove('dim-none', 'dim-light', 'dim-classic')
  b.classList.add(`dim-${prefs.selectionDim}`)
}

/* ── Session states ────────────────────────────────────────────────────── */
/** Glow-only waiting state while desktopCapturer is still running. */
function enterWaiting(m: CircleMode, prefs: CapturePrefs): void {
  mode = m
  frozenReady = false
  lensMode = false
  applyPrefs(prefs)
  document.body.classList.remove('lens-mode', 'ready', 'dragging')
  document.body.classList.add('awake', 'capturing')
  resetSelection()
  img.onload = null
  img.onerror = null
  img.src = TRANSPARENT_PIXEL
  hintText.textContent = 'Preparing screen…'
  hintSpinner.hidden = false
  attachHint.hidden = true
  window.gdc.circle.ready()
}

function setHints(): void {
  hintSpinner.hidden = true
  attachHint.hidden = true
  if (mode === 'attach') {
    hintText.textContent = 'Drag over the region to attach'
    attachHint.hidden = false
  } else {
    hintText.textContent = 'Drag to select anything on screen'
  }
}

async function applyCapture(payload: CapturePayload): Promise<void> {
  mode = payload.mode
  scaleFactor = payload.scaleFactor
  lensMode = false
  applyPrefs(payload.prefs ?? DEFAULT_PREFS)
  document.body.classList.remove('lens-mode', 'dragging')
  document.body.classList.add('awake')
  resetSelection()
  setHints()
  await new Promise<void>((resolve) => {
    img.onload = () => resolve()
    img.onerror = () => resolve() // Esc still works; main watchdog still armed
    img.src = payload.dataUrl ?? TRANSPARENT_PIXEL
  })
  frozenReady = !!payload.dataUrl
  document.body.classList.remove('capturing')
  document.body.classList.add('ready')
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  window.gdc.circle.ready()
}

async function init(): Promise<void> {
  // Warm reuse pushes frames through onSetImage — listen BEFORE any await
  // so an early frame can never race this setup.
  window.gdc.circle.onSetImage((raw) => {
    const p = raw as CapturePayload
    if (!p.dataUrl) {
      enterWaiting(p.mode, p.prefs ?? DEFAULT_PREFS)
      return
    }
    void applyCapture(p)
  })
  window.gdc.settings.onPrefsChanged((raw) => applyPrefs(raw as CapturePrefs))

  const capture = (await window.gdc.circle.getCapture()) as CapturePayload | null
  if (capture?.dataUrl) {
    await applyCapture(capture)
  } else {
    enterWaiting(capture?.mode ?? 'lens', capture?.prefs ?? DEFAULT_PREFS)
  }
}

/* ── Lens mode (results open) ──────────────────────────────────────────── */
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
      resetSelection()
    } else {
      void window.gdc.circle.dismissAll()
    }
  }
})

/* ── Selection drag ────────────────────────────────────────────────────── */
sel.addEventListener('pointerdown', (e) => {
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
  document.body.classList.add('dragging')
  selBox.style.display = 'block'
  updateBox(e.clientX, e.clientY)
})

sel.addEventListener('pointermove', (e) => {
  if (!dragging) return
  if (Math.abs(e.clientX - startX) > 6 || Math.abs(e.clientY - startY) > 6) moved = true
  updateBox(e.clientX, e.clientY)
})

sel.addEventListener('pointercancel', () => {
  dragging = false
  resetSelection()
})

window.addEventListener('contextmenu', (e) => e.preventDefault())

sel.addEventListener('pointerup', (e) => {
  if (!dragging) return
  dragging = false
  document.body.classList.remove('dragging')
  const rect = normalizedRect(e.clientX, e.clientY)

  if (!moved) {
    // A plain click (no drag) searches / attaches the WHOLE screen.
    submitRect({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
    return
  }
  if (rect.width < 10 || rect.height < 10) {
    resetSelection()
    return
  }
  submitRect(rect)
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
  // Keep the badge on screen: flip above the box near the bottom edge.
  const below = rect.y + rect.height + 34 < window.innerHeight
  selBadge.style.top = below ? `${rect.y + rect.height}px` : `${rect.y - 32}px`
}

function normalizedRect(x: number, y: number): SelectionRect {
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
  document.body.classList.remove('dragging')
}

/** Play the capture flash, then hand the rect to main for a lossless crop. */
function submitRect(rect: SelectionRect): void {
  flash.style.left = `${rect.x}px`
  flash.style.top = `${rect.y}px`
  flash.style.width = `${rect.width}px`
  flash.style.height = `${rect.height}px`
  flash.classList.remove('go')
  void flash.offsetWidth // restart the animation
  flash.classList.add('go')
  selBox.style.display = 'none'
  selBadge.hidden = true
  void window.gdc.circle.selectRect(rect)
}