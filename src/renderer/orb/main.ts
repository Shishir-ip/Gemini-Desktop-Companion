/**
 * Draggable Gemini orb. Click (short press, little movement) reopens the
 * palette with full context; dragging moves it anywhere on screen.
 */

let pressed = false
let pressTime = 0
let moved = 0
let lastX = 0
let lastY = 0

window.addEventListener(
  'pointerdown',
  (e) => {
    if (!e.isPrimary) return
    pressed = true
    pressTime = Date.now()
    moved = 0
    lastX = e.screenX
    lastY = e.screenY
    window.gdc.orb.dragStart()
  },
  true
)

window.addEventListener(
  'pointermove',
  (e) => {
    if (!pressed || !e.isPrimary) return
    const dx = e.screenX - lastX
    const dy = e.screenY - lastY
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    moved += Math.abs(dx) + Math.abs(dy)
    lastX = e.screenX
    lastY = e.screenY
    window.gdc.orb.dragMove(dx, dy)
  },
  true
)

window.addEventListener(
  'pointerup',
  (e) => {
    if (!pressed || !e.isPrimary) return
    pressed = false
    const quick = moved < 8 && Date.now() - pressTime < 600
    if (quick) {
      void window.gdc.orb.open()
    }
  },
  true
)
