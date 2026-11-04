import { contextBridge, ipcRenderer } from 'electron'

type Listener<T> = (payload: T) => void

/**
 * NOTE: Channel names are duplicated here (instead of importing
 * src/shared/ipc.ts) because sandboxed preload scripts cannot load
 * code-split chunks — each preload bundle must be fully self-contained.
 * Keep in sync with src/shared/ipc.ts.
 */
const IPC = {
  CircleGetCapture: 'circle:get-capture',
  CircleReady: 'circle:ready',
  CircleSelected: 'circle:selected',
  CircleCancel: 'circle:cancel',
  CircleDismissAll: 'circle:dismiss-all',
  CircleSetLensMode: 'circle:set-lens-mode',
  LensRetry: 'lens:retry',
  LensOpenWeb: 'lens:open-web',
  ResultsGetCrop: 'results:get-crop',
  ResultsAnalyze: 'results:analyze',
  GeminiGetState: 'gemini:get-state',
  GeminiSubmit: 'gemini:submit',
  GeminiAttachFromScreen: 'gemini:attach-from-screen',
  GeminiRemoveAttachment: 'gemini:remove-attachment',
  GeminiNewChat: 'gemini:new-chat',
  GeminiClose: 'gemini:close',
  WidgetSetIgnoreMouse: 'widget:set-ignore-mouse',
  GeminiApiChanged: 'gemini:api-changed',
  GeminiStatus: 'gemini:status',
  GeminiChunk: 'gemini:chunk',
  GeminiDone: 'gemini:done',
  GeminiError: 'gemini:error',
  GeminiAttachmentChanged: 'gemini:attachment-changed',
  SettingsOpen: 'settings:open',
  SettingsGetAll: 'settings:get-all',
  SettingsSetHotkeys: 'settings:set-hotkeys',
  SettingsSetStartup: 'settings:set-startup',
  SettingsCheckApi: 'settings:check-api',
  SettingsSetApiKey: 'settings:set-api-key',
  SettingsClearApiKey: 'settings:clear-api-key',
  SettingsOpenApiKeys: 'settings:open-apikeys',
  SettingsCheckUpdates: 'settings:check-updates',
  ApiChanged: 'api:changed',
  AppOpenExternal: 'app:open-external',
  AppStartCircle: 'app:start-circle',
  AppShowWidget: 'app:show-widget',
  WindowClose: 'window:close',
  WindowMinimize: 'window:minimize'
} as const

function subscribe<T>(channel: string, callback: Listener<T>): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.off(channel, listener)
  }
}

const api = {
  /** Circle to Search selection overlay. */
  circle: {
    getCapture: () => ipcRenderer.invoke(IPC.CircleGetCapture),
    /** Tell the main process this overlay painted and is interactive. */
    ready: () => ipcRenderer.send(IPC.CircleReady),
    selectFinished: (dataUrl: string) => ipcRenderer.invoke(IPC.CircleSelected, dataUrl),
    cancel: () => ipcRenderer.invoke(IPC.CircleCancel),
    dismissAll: () => ipcRenderer.invoke(IPC.CircleDismissAll),
    outsideClick: () => ipcRenderer.invoke('circle:outside-click'),
    onSetLensMode: (cb: Listener<void>) => subscribe(IPC.CircleSetLensMode, cb)
  },

  /** Floating Gemini command palette. */
  gemini: {
    getState: () => ipcRenderer.invoke(IPC.GeminiGetState),
    submit: (text: string) => ipcRenderer.invoke(IPC.GeminiSubmit, text),
    attachFromScreen: () => ipcRenderer.invoke(IPC.GeminiAttachFromScreen),
    removeAttachment: () => ipcRenderer.invoke(IPC.GeminiRemoveAttachment),
    newChat: () => ipcRenderer.invoke(IPC.GeminiNewChat),
    close: () => ipcRenderer.invoke(IPC.GeminiClose),
    onStatus: (cb: Listener<unknown>) => subscribe(IPC.GeminiStatus, cb),
    onChunk: (cb: Listener<unknown>) => subscribe(IPC.GeminiChunk, cb),
    onDone: (cb: Listener<unknown>) => subscribe(IPC.GeminiDone, cb),
    onError: (cb: Listener<unknown>) => subscribe(IPC.GeminiError, cb),
    onAttachment: (cb: Listener<unknown>) => subscribe(IPC.GeminiAttachmentChanged, cb),
    onApiChanged: (cb: Listener<unknown>) => subscribe(IPC.GeminiApiChanged, cb)
  },

  /**
   * Click-through control for the transparent palette window: while true the
   * window ignores mouse events entirely (desktop clicks pass through) but
   * still receives forwarded hover moves so the renderer can flip it back.
   */
  widget: {
    setIgnoreMouse: (ignore: boolean) => ipcRenderer.invoke(IPC.WidgetSetIgnoreMouse, ignore)
  },

  /** Settings window. */
  settings: {
    open: () => ipcRenderer.invoke(IPC.SettingsOpen),
    getAll: () => ipcRenderer.invoke(IPC.SettingsGetAll),
    setHotkeys: (hotkeys: { circleToSearch: string; holdToGemini: string }) =>
      ipcRenderer.invoke(IPC.SettingsSetHotkeys, hotkeys),
    setStartup: (enabled: boolean) => ipcRenderer.invoke(IPC.SettingsSetStartup, enabled),
    checkApi: () => ipcRenderer.invoke(IPC.SettingsCheckApi),
    setApiKey: (key: string) => ipcRenderer.invoke(IPC.SettingsSetApiKey, key),
    clearApiKey: () => ipcRenderer.invoke(IPC.SettingsClearApiKey),
    openApiKeys: () => ipcRenderer.invoke(IPC.SettingsOpenApiKeys),
    checkUpdates: () => ipcRenderer.invoke(IPC.SettingsCheckUpdates),
    onApiChanged: (cb: Listener<unknown>) => subscribe(IPC.ApiChanged, cb)
  },

  /** Lens results panel actions. */
  lens: {
    retry: () => ipcRenderer.invoke(IPC.LensRetry),
    openWeb: () => ipcRenderer.invoke(IPC.LensOpenWeb),
    getCrop: () => ipcRenderer.invoke(IPC.ResultsGetCrop),
    analyze: () => ipcRenderer.invoke(IPC.ResultsAnalyze),
    closePanel: () => ipcRenderer.invoke(IPC.WindowClose),
    onError: (cb: Listener<unknown>) => subscribe('lens:error', cb)
  },

  /** Model switcher (palette). */
  models: {
    setModel: (model: string) => ipcRenderer.invoke('gemini:set-model', model)
  },

  /** Generic helpers available to every window. */
  app: {
    startCircleToSearch: () => ipcRenderer.invoke(IPC.AppStartCircle),
    showGemini: () => ipcRenderer.invoke(IPC.AppShowWidget)
  },
  win: {
    close: () => ipcRenderer.invoke(IPC.WindowClose),
    minimize: () => ipcRenderer.invoke(IPC.WindowMinimize)
  },
  openExternal: (url: string) => ipcRenderer.invoke(IPC.AppOpenExternal, url)
}

export type GdcApi = typeof api

contextBridge.exposeInMainWorld('gdc', api)
