import { app } from 'electron'
import path from 'node:path'

/**
 * Resolve on-disk asset paths. In development assets live in the project
 * folder; in a packaged build electron-builder copies `resources/` next to
 * the app executable (see extraResources in electron-builder.yml).
 */
export function getAssetPath(...segments: string[]): string {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(app.getAppPath(), 'resources')
  return path.join(base, ...segments)
}

/** Absolute path to a built preload script (out/preload/<name>.js). */
export function preloadPath(name: string): string {
  return path.join(__dirname, '../preload', `${name}.js`)
}

/**
 * Load a renderer page. electron-vite serves the renderer via HTTP in dev
 * and writes static HTML files for production (out/renderer/<page>/index.html).
 */
export function loadRendererPage(win: Electron.BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(`${devUrl}/${page}/index.html`)
  } else {
    void win.loadFile(path.join(__dirname, `../renderer/${page}/index.html`))
  }
}

/** Chrome-like user agent with the Electron token stripped (Google-friendly). */
export function chromeUserAgent(): string {
  return app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/i, '')
    .replace(/\sGeminiDesktopCompanion\/[\d.]+/i, '')
    .replace(/\sapp\/[\d.]+/i, '')
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
