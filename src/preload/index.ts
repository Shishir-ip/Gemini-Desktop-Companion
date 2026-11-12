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
  CircleSetImage: 'circle:set-image',
  CircleReady: 'circle:ready',
  CircleSelectRect: 'circle:select-rect',
  CircleCancel: 'circle:cancel',
  CircleDismissAll: 'circle:dismiss-all',
  CircleSetLensMode: 'circle:set-lens-mode',
  LensRetry: 'lens:retry',
  LensOpenWeb: 'lens:open-web',
  LensCopyImage: 'lens:copy-image',
  LensSaveImage: 'lens:save-image',
  LensAskGemini: 'lens:ask-gemini',
  ResultsGetCrop: 'results:get-crop',
  ResultsAnalyze: 'results:analyze',
  GeminiGetState: 'gemini:get-state',
  GeminiSubmit: 'gemini:submit',
  GeminiAttachFromScreen: 'gemini:attach-from-screen',
  GeminiRemoveAttachment: 'gemini:remove-attachment',
  GeminiNewChat: 'gemini:new-chat',
  GeminiClose: 'gemini:close',
  GeminiMinimize: 'gemini:minimize',
  GeminiPip: 'gemini:pip',
  GeminiStop: 'gemini:stop',
  WidgetShown: 'widget:shown',
  WidgetResize: 'widget:resize',
  ThemeChanged: 'theme:changed',
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
  SettingsSetTheme: 'settings:set-theme',
  SettingsSetPrefs: 'settings:set-prefs',
  PrefsChanged: 'prefs:changed',
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
    onSetImage: (cb: Listener<unknown>) => subscribe(IPC.CircleSetImage, cb),
    /** Tell the main process this overlay painted and is interactive. */
    ready: () => ipcRenderer.send(IPC.CircleReady),
    /** Hand the selection rect to main — it crops the lossless original. */
    selectRect: (rect: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke(IPC.CircleSelectRect, rect),
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
    minimize: () => ipcRenderer.invoke(IPC.GeminiMinimize),
    stop: () => ipcRenderer.invoke(IPC.GeminiStop),
    onStatus: (cb: Listener<unknown>) => subscribe(IPC.GeminiStatus, cb),
    onChunk: (cb: Listener<unknown>) => subscribe(IPC.GeminiChunk, cb),
    onDone: (cb: Listener<unknown>) => subscribe(IPC.GeminiDone, cb),
    onError: (cb: Listener<unknown>) => subscribe(IPC.GeminiError, cb),
    onAttachment: (cb: Listener<unknown>) => subscribe(IPC.GeminiAttachmentChanged, cb),
    onApiChanged: (cb: Listener<unknown>) => subscribe(IPC.GeminiApiChanged, cb),
    onShown: (cb: Listener<void>) => subscribe(IPC.WidgetShown, cb)
  },

  /**
   * Palette self-sizing: the renderer reports its content height and the
   * main process keeps the window bottom-anchored (window hugs the cards —
   * no invisible interactive regions, no click-through machinery).
   */
  widget: {
    resize: (height: number) => ipcRenderer.send(IPC.WidgetResize, Math.round(height))
  },

  /** Settings window. */
  settings: {
    open: () => ipcRenderer.invoke(IPC.SettingsOpen),
    getAll: () => ipcRenderer.invoke(IPC.SettingsGetAll),
    setHotkeys: (hotkeys: { circleToSearch: string; holdToGemini: string }) =>
      ipcRenderer.invoke(IPC.SettingsSetHotkeys, hotkeys),
    setStartup: (enabled: boolean) => ipcRenderer.invoke(IPC.SettingsSetStartup, enabled),
    setTheme: (theme: string) => ipcRenderer.invoke(IPC.SettingsSetTheme, theme),
    setPrefs: (prefs: Record<string, unknown>) => ipcRenderer.invoke(IPC.SettingsSetPrefs, prefs),
    onPrefsChanged: (cb: Listener<unknown>) => subscribe(IPC.PrefsChanged, cb),
    onThemeChanged: (cb: Listener<string>) => subscribe(IPC.ThemeChanged, cb),
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
    getCrop: () => ipcRenderer.invoke(IPC.ResultsGetCrop),
    analyze: () => ipcRenderer.invoke(IPC.ResultsAnalyze),
    openWeb: () => ipcRenderer.invoke(IPC.LensOpenWeb),
    copyImage: () => ipcRenderer.invoke(IPC.LensCopyImage) as Promise<{ ok: boolean }>,
    saveImage: () => ipcRenderer.invoke(IPC.LensSaveImage) as Promise<{ ok: boolean; path?: string }>,
    askGemini: () => ipcRenderer.invoke(IPC.LensAskGemini),
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
