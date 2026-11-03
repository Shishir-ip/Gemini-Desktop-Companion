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
  GeminiLoginChanged: 'gemini:login-changed', // main → widget renderer
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
  SettingsCheckLogin: 'settings:check-login',
  SettingsOpenLogin: 'settings:open-login',
  SettingsCheckUpdates: 'settings:check-updates',
  SettingsOpenHistory: 'settings:open-history',
  LoginChanged: 'login:changed', // main → settings renderer

  // ── Generic ─────────────────────────────────────────────────────────────
  AppOpenExternal: 'app:open-external',
  AppStartCircle: 'app:start-circle',
  AppShowWidget: 'app:show-widget',
  WindowClose: 'window:close',
  WindowMinimize: 'window:minimize',

  // ── Hidden Gemini web page bridge ───────────────────────────────────────
  GeminiPageStream: 'gemini:page-stream'
} as const
