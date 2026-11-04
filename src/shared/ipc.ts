/** IPC channel names shared between main, preload and renderers. */
export const IPC = {
  // ── Circle to Search overlay ────────────────────────────────────────────
  CircleGetCapture: 'circle:get-capture',
  CircleReady: 'circle:ready',
  CircleSelected: 'circle:selected',
  CircleCancel: 'circle:cancel',
  CircleDismissAll: 'circle:dismiss-all',
  CircleSetLensMode: 'circle:set-lens-mode',

  // ── Lens panel ──────────────────────────────────────────────────────────
  LensRetry: 'lens:retry',

  // ── Gemini floating widget ──────────────────────────────────────────────
  GeminiGetState: 'gemini:get-state',
  GeminiSubmit: 'gemini:submit',
  GeminiAttachFromScreen: 'gemini:attach-from-screen',
  GeminiRemoveAttachment: 'gemini:remove-attachment',
  GeminiNewChat: 'gemini:new-chat',
  GeminiClose: 'gemini:close',
  WidgetSetIgnoreMouse: 'widget:set-ignore-mouse',
  GeminiApiChanged: 'gemini:api-changed', // main → widget renderer
  GeminiStatus: 'gemini:status', // main → renderer
  GeminiChunk: 'gemini:chunk', // main → renderer
  GeminiDone: 'gemini:done', // main → renderer
  GeminiError: 'gemini:error', // main → renderer
  GeminiAttachmentChanged: 'gemini:attachment-changed', // main → renderer

  // ── Settings ────────────────────────────────────────────────────────────
  SettingsOpen: 'settings:open',
  SettingsGetAll: 'settings:get-all',
  SettingsSetHotkeys: 'settings:set-hotkeys',
  SettingsSetStartup: 'settings:set-startup',
  SettingsCheckApi: 'settings:check-api',
  SettingsSetApiKey: 'settings:set-api-key',
  SettingsClearApiKey: 'settings:clear-api-key',
  SettingsOpenApiKeys: 'settings:open-apikeys',
  SettingsCheckUpdates: 'settings:check-updates',
  ApiChanged: 'api:changed', // main → UIs

  // ── Generic ─────────────────────────────────────────────────────────────
  AppOpenExternal: 'app:open-external',
  AppStartCircle: 'app:start-circle',
  AppShowWidget: 'app:show-widget',
  WindowClose: 'window:close',
  WindowMinimize: 'window:minimize'
} as const