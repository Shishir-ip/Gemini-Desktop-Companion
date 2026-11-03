import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'

/**
 * Bridge injected into the hidden Gemini web page. The page-side observer
 * script (see src/main/gemini/session.ts) calls these to stream responses
 * back to the main process.
 */
contextBridge.exposeInMainWorld('geminiPageBridge', {
  stream: (full: string, done: boolean) => {
    ipcRenderer.send(IPC.GeminiPageStream, { full, done })
  }
})
