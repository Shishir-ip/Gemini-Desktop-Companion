/**
 * Draggable Gemini orb. Click (short press, little movement) reopens the
 * palette with full context; dragging moves it anywhere on screen.
 */

let pressX = 0
let pressY = 0
let lastX = 0
let lastY = 0
let moved = 0
let pressed = false
const pressTime = 0

window.addEventListener('pointerdown', (e) => {
  pressed = true
  moved = 0
  pressX = e.screenX
  pressY = e.screenY
  lastX = e.screenX
  lastY = e.screenY
  void window.gdc.orb.dragStart()
})

window.addEventListener('pointermove', (e) => {
  if (!pressed) return
  const dx = e.screenX - lastX
  const dy = e.screenY - lastY
  moved += Math.abs(dx) + Math.abs(dy)
  lastX = e.screenX
  lastY = e.screenY
  void window.gdc.orb.dragMove(dx, dy)
})

window.addEventListener('pointerup', (e) => {
  if (!pressed) return
  pressed = false
  const dt = Date.now() - (window as unknown as { __pressT?: number }).__pressT!
  void (window as unknown as { __pressT?: number }).__pressT
  const quick = moved < 8
  if (quick) {
    // Treat as a click — reopen the palette with full context.
    void window.gdc.orb.open()
  }
  void dt
  void pressTime
})

// Track press time for click detection.
window.addEventListener(
  'pointerdown',
  () => {
    ;(window as unknown as { __pressT?: number }).__pressT = Date.now()
  },
  true
)
