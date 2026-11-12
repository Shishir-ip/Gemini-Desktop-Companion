# Changelog

All notable changes to **Gemini Desktop Companion** are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [4.1.0] — 2026-11-12

### Fixed
- **API key panel kept showing after connecting.** The `hidden` attribute was being overridden by CSS `display` rules; a global `[hidden] { display: none !important }` rule now guarantees the connect banner disappears the moment a key is validated — on Home, in the Gemini pill, and in Settings.
- Home's **Manage key** now opens the app Settings (the single place to change/remove the key) instead of the AI Studio website.

### Added
- **Remove key** button in Settings → Gemini API (change / remove / add without leaving the app).
- SEO-ready README with feature screenshot gallery, one-click download button, and FAQ.

## [4.0.0] — 2026-11-12

Ground-up redesign + reliability overhaul.

### Fixed — the big ones
- **Black overlay on wake.** Software compositing (`disableHardwareAcceleration`) renders transparent windows black on Windows — GPU compositing is now kept on.
- **4–5 second wake.** `desktopCapturer.getSources` takes 3–6s on many machines. New persistent **GDI capture runspace** (~150–250ms) + pre-warmed overlay/pill windows → **~200ms hotkey-to-screen**, with automatic `desktopCapturer` fallback.
- **Dirty crops (dim/overlay baked into the image).** The screen is now captured *before* any overlay is shown, and crops are cut **in the main process from the lossless original** — overlay UI can never leak into a capture.
- **Duplicate / lingering overlays.** Strict single-session re-trigger guard, stale-frame clearing on hide, monitor hot-plug handling, and a main-process Esc kill-switch.
- **Second screen-attachment not applying** in the Gemini panel — attach flow verified across repeated attaches, mid-stream attaches, Esc-cancel retries, and whole-screen clicks.

### Added
- **Apple-Intelligence-style rim glow** for Circle to Search (two cross-fading inset-shadow layers, opacity-only animation, desktop-tuned), replacing the black dim.
- **Glowing selection tool**: gradient-free steel ring, corner handles, live size badge, spotlight focus dim, capture flash.
- **Android-style Gemini pill**: bottom-anchored capsule (＋ capture · prompt · model chips · send) that expands into a scrollable chat sheet; **New Chat** and **Minimise** capsules; close ✕; quick actions (Explain / Summarize / Translate / Solve / Write code) on empty chat and after attaching.
- **Lens action toolbar**: Ask Gemini · Copy · Save · Retry · Open in browser · Close.
- **Settings → Selection & Capture**: glow on/off, glow intensity (Subtle/Balanced/Vivid), focus dim (None/Light/Classic), copy crops to clipboard, auto-save captures to Pictures/Gemini Captures.
- Pre-warmed windows + capture pipeline at startup; self-sizing pill window; solid Home/Settings windows.

### Changed
- **Solid, professional design language**: greyish graphite dark + soft white light themes, no transparency/frosted glass, no rainbow gradients, one restrained steel-blue accent.
- **New premium monochrome logo** (graphite tile + polished silver sparkle) across app icon, tray, and headers.
- Gemini panel positioned slightly higher above the bottom edge and widened (720px).
- README rewritten with screenshots, download button, and search-friendly docs.

### Removed
- Gemini wake glow (per user preference — the rim glow remains on Circle to Search only).
- Mic button inside the pill (replaced by the send button; voice typing remains available where supported).
- Colorful aurora/gradient styling across all surfaces.

## [3.6.1] — previous baseline

- Circle to Search with frozen-screen selection and Google Lens results panel.
- Hold to Gemini floating palette (official Gemini API, SSE streaming, model switcher, voice typing, code copy).
- Glassmorphic UI, tray daemon, custom hotkeys, launch-at-startup, update check.

[4.1.0]: https://github.com/Shishir-ip/Gemini-Desktop-Companion/releases/tag/v4.1.0
[4.0.0]: https://github.com/Shishir-ip/Gemini-Desktop-Companion/releases/tag/v4.0.0