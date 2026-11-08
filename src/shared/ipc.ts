/** IPC channel names shared between main, preload and renderers. */
export const IPC = {
  // ── Circle to Search overlay ────────────────────────────────────────────
  CircleGetCapture: 'circle:get-capture',
  CircleSetImage: 'circle:set-image',
  CircleReady: 'circle:ready',
  CircleSelected: 'circle:selected',
  CircleCancel: 'circle:cancel',
  CircleDismissAll: 'circle:dismiss-all',
  CircleSetLensMode: 'circle:set-lens-mode',

  // ── Lens panel ──────────────────────────────────────────────────────────
  LensRetry: 'lens:retry',
  LensOpenWeb: 'lens:open-web',
  ResultsGetCrop: 'results:get-crop',
  ResultsAnalyze: 'results:analyze',

  // ── Gemini floating widget ──────────────────────────────────────────────
  GeminiGetState: 'gemini:get-state',
  GeminiSubmit: 'gemini:submit',
  GeminiAttachFromScreen: 'gemini:attach-from-screen',
  GeminiRemoveAttachment: 'gemini:remove-attachment',
  GeminiNewChat: 'gemini:new-chat',
  GeminiClose: 'gemini:close',
  GeminiPip: 'gemini:pip',
  GeminiStop: 'gemini:stop',
  WidgetShown: 'widget:shown',
  WidgetResize: 'widget:resize',
  ThemeChanged: 'theme:changed',
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
  SettingsSetTheme: 'settings:set-theme',
  SettingsSetOrbSide: 'settings:set-orb-side',
  OrbSideChanged: 'orb-side:changed',
  ApiChanged: 'api:changed', // main → UIs

  // ── Generic ─────────────────────────────────────────────────────────────
  AppOpenExternal: 'app:open-external',
  AppStartCircle: 'app:start-circle',
  OrbOpen: 'orb:open',
  OrbDragStart: 'orb:drag-start',
  OrbDragMove: 'orb:drag-move',
  OrbDragEnd: 'orb:drag-end',
  AppShowWidget: 'app:show-widget',
  WindowClose: 'window:close',
  WindowMinimize: 'window:minimize'
} as const