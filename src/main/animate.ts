import type { BrowserWindow, Rectangle } from 'electron'

/**
 * Tween a window's bounds with an ease-out cubic curve (≈200ms, iOS feel).
 * Safe to call on windows that may get destroyed mid-animation.
 */
export function animateWindowBounds(
  win: BrowserWindow,
  from: Rectangle,
  to: Rectangle,
  duration = 220
): void {
  const start = Date.now()
  const ease = (t: number): number => 1 - Math.pow(1 - t, 3)
  const timer = setInterval(() => {
    if (win.isDestroyed()) {
      clearInterval(timer)
      return
    }
    const k = Math.min(1, (Date.now() - start) / duration)
    const e = ease(k)
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: Math.round(from.y + (to.y - from.y) * e),
      width: Math.round(from.width + (to.width - from.width) * e),
      height: Math.round(from.height + (to.height - from.height) * e)
    })
    if (k >= 1) clearInterval(timer)
  }, 16)
}
