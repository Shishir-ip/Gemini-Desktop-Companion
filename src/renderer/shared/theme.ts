/**
 * Theme bootstrap shared by every renderer page. Reads the stored theme,
 * applies `data-theme` on <html>, follows the system in auto mode, and
 * live-applies changes pushed from Settings.
 */

export type ThemeName = 'auto' | 'dark' | 'light'

let current: ThemeName = 'dark'

function resolve(theme: ThemeName): 'dark' | 'light' {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function applyTheme(theme: string): void {
  current = (['auto', 'dark', 'light'].includes(theme) ? theme : 'dark') as ThemeName
  document.documentElement.dataset.theme = resolve(current)
}

export function initTheme(): void {
  void window.gdc.settings.getAll().then((s) => {
    applyTheme((s as { theme?: string }).theme ?? 'dark')
  })
  window.gdc.settings.onThemeChanged((t) => applyTheme(String(t)))
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (current === 'auto') applyTheme('auto')
    })
}

