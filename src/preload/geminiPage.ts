import { contextBridge, ipcRenderer } from 'electron'

/**
 * Bridge injected into the hidden Gemini web page. The page-side observer
 * script (see src/main/gemini/session.ts) calls these to stream responses
 * back to the main process.
 *
 * NOTE: Channel names are duplicated here (instead of importing
 * src/shared/ipc.ts) because sandboxed preload scripts cannot load
 * code-split chunks — each preload bundle must be fully self-contained.
 * Keep in sync with src/shared/ipc.ts.
 */
contextBridge.exposeInMainWorld('geminiPageBridge', {
  stream: (full: string, done: boolean) => {
    ipcRenderer.send('gemini:page-stream', { full, done })
  }
})
