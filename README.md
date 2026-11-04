<div align="center">

# ✨ Gemini Desktop Companion

**Android-style *Circle to Search* + *Hold to Gemini* for Windows — a glassmorphic AI companion living in your system tray.**

[![Release](https://img.shields.io/github/v/release/Shishir-ip/Gemini-Desktop-Companion?style=flat-square&logo=github&color=a855f7)](https://github.com/Shishir-ip/Gemini-Desktop-Companion/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078d4?style=flat-square&logo=windows11)](#)
[![Built with](https://img.shields.io/badge/built%20with-Electron%20·%20TypeScript%20·%20Vite%20·%20Tailwind-4f8cff?style=flat-square)](#)
[![License](https://img.shields.io/badge/license-MIT-30d158?style=flat-square)](LICENSE)

</div>

---

Gemini Desktop Companion puts two of Android's most-loved AI gestures on your Windows desktop:

- **Circle to Search** — freeze your entire screen with a hotkey, circle anything on it, and get Google Lens results in an Android-style slide-out panel (with built-in text-to-speech).
- **Hold to Gemini** — summon a floating, iOS-style command palette from anywhere. Attach a screen selection with a click, ask anything, and watch the answer stream in live — powered by your own Google account, so **every conversation is saved to your Gemini history**.

No API keys. No daemons phoning home. Just your Google session and a beautiful overlay.

---

## 📑 Table of Contents

- [Features](#-features)
- [Screens & Interactions](#-screens--interactions)
- [Default Shortcuts](#-default-shortcuts)
- [Getting Started](#-getting-started)
  - [Install (release build)](#install-release-build)
  - [Run from source (dev)](#run-from-source-dev)
  - [Build the installer](#build-the-installer)
- [Google Login & History](#-google-login--history)
- [Project Structure](#-project-structure)
- [How It Works](#-how-it-works)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [Privacy](#-privacy)
- [Roadmap](#-roadmap)
- [License](#-license)

---

## 🌟 Features

| Area | What you get |
| --- | --- |
| **🎯 Circle to Search** | One hotkey freezes every connected monitor behind a selection canvas. Drag a rectangle (pixel-exact, HiDPI-aware), and the crop is uploaded to **Google Lens**. Results slide out from the right edge in a frosted-glass panel. |
| **🔊 Read-aloud (TTS)** | The Lens panel injects a speaker button next to every scraped text block plus a floating *Read all* bar — one click and Windows' Web Speech API reads it to you. |
| **💬 Hold to Gemini** | A floating bottom-sheet command palette, centered above your taskbar. Ask anything; responses stream in live with markdown rendering, copy & new-chat actions. |
| **📸 Screenshot context** | Crop a region *before* or *after* opening Gemini — or hit the paperclip in the palette — and the image is attached to your prompt automatically. |
| **🔐 Google Login** | Sign in once through the built-in session window. Cookies persist in an isolated Chromium partition, and **all chats land in your real Gemini account history** at [gemini.google.com](https://gemini.google.com/app). |
| **⚙️ iOS-style Settings** | Live hotkey recorders, *Launch at Windows startup* toggle, Google session indicator with one-click re-login, and update checks. |
| **🖥️ System Tray Daemon** | Runs silently in the tray. Left-click opens Gemini; right-click gives you Settings / Check for Updates / Quit. Closing windows never quits the app. |
| **🚀 Boot Persistence** | Registers itself with Windows startup (`app.setLoginItemSettings`) — toggleable any time in Settings. |
| **⌨️ Custom Global Shortcuts** | Both feature hotkeys are re-recordable in Settings with live key capture and conflict detection. |
| **🎨 Design** | Frosted glassmorphism (`backdrop-filter: blur(24px)`), 1 px light borders, soft glow shadows, Inter/SF Pro typography, buttery `cubic-bezier(0.32, 0.72, 0, 1)` 200 ms animations. |

## 🖥 Screens & Interactions

```text
┌───────────────────────────────────────────────┬─────────────┐
│                                               │  ┌────────┐ │
│   (frozen, dimmed screen)                     │  │  Lens  │ │
│                                               │  │ result │ │
│        ╔═══════════════╗                      │  │  panel │ │
│        ║  your drag    ║  ← Circle to Search  │  │  🔊 ⏹  │ │
│        ╚═══════════════╝                      │  └────────┘ │
│   hint: Drag to select · Esc to cancel        │  slide-out  │
└───────────────────────────────────────────────┴─────────────┘

┌─────────────────────────────────────────────────────────────┐
│  (your desktop)                                             │
│            ╭───────────────────────────────────╮            │
│            │ ✦ Gemini ● ──── 🕘 📎 ✕           │            │
│            │ [ 🖼 Screen selection · PNG ]  ✕  │            │
│            │ Ask Gemini anything…          ⬆  │            │
│            ╰───────────────────────────────────╯            │
│                 ↑ Hold to Gemini floating palette           │
└─────────────────────────────────────────────────────────────┘
```

## ⌨️ Default Shortcuts

| Action | Default | Customizable |
| --- | --- | --- |
| Circle to Search | <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>C</kbd> | ✅ Settings → Shortcuts |
| Hold to Gemini | <kbd>Alt</kbd> + <kbd>Space</kbd> | ✅ Settings → Shortcuts |
| Open Settings | <kbd>Ctrl</kbd> + <kbd>,</kbd> | ❌ fixed |
| Dismiss any overlay | <kbd>Esc</kbd> / outside click | — |

**Where is Settings?** ⚙️ gear in the Gemini palette · system-tray right-click → *Settings…* · <kbd>Ctrl</kbd>+<kbd>,</kbd> · the palette on first launch opens it automatically.

> **Circle to Search gestures:** *drag* selects a region; a plain *click* (no drag) searches the **full screen**; while Lens results are open, clicking the frozen screen dismisses everything. In the palette, the 📎 paperclip uses the same selection overlay — a click attaches the whole screen, a drag attaches just that region.

> **Hold to Gemini** toggles: press once to open the palette, press again (or <kbd>Esc</kbd>) to dismiss — the friendliest "hold" behavior for a global hotkey, since Windows doesn't deliver global key-up events to background apps.

> ⚠️ <kbd>Alt</kbd> + <kbd>Space</kbd> normally opens the focused window's system menu. Global shortcuts win, so it's safe to use — but you can rebind it in Settings if you prefer.

## 🚀 Getting Started

### Install (release build)

1. Grab **`Gemini-Desktop-Companion-Setup-1.1.0.exe`** from the [latest release](https://github.com/Shishir-ip/Gemini-Desktop-Companion/releases).
2. Run the installer (per-user; desktop + Start Menu shortcuts included).
3. Launch it — the **Home window opens** and walks you through everything: both features, their shortcuts, and the account status. Sign in, press *Try it now*, and you're off.

> Launching again or clicking the ✨ tray icon re-opens Home. Hotkeys work from anywhere, always.

> Windows SmartScreen may warn about the unsigned installer — click *More info → Run anyway*. Build it from source yourself if you prefer (below).

### Run from source (dev)

Prerequisites: **Node.js ≥ 18** and npm.

```bash
git clone https://github.com/Shishir-ip/Gemini-Desktop-Companion.git
cd Gemini-Desktop-Companion
npm install        # also generates app icons (postinstall)
npm run dev        # electron-vite dev with HMR
```

Other useful scripts:

```bash
npm run typecheck  # strict TypeScript across main/preload/renderer
npm run build      # production bundles to out/
npm run icons      # regenerate build/icon.ico + tray assets
```

### Build the installer

```bash
npm run dist       # typecheck → build → electron-builder (NSIS, x64)
```

The artifact lands at `release/<version>/Gemini-Desktop-Companion-Setup-<version>.exe`.

## 🔑 Connecting Gemini (free API key)

Gemini runs on the **official Gemini API** (Google AI Studio) — the reliable path: no sign-in dance, no scraping, no "browser not secure" walls, and it streams properly through any network setup.

1. In the **Home window** (or Settings → Gemini API, or the palette's banner), click **Get API key** — your browser opens [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with your Google account and click **Create API key** (free tier included).
3. Copy the key (starts with `AIza`), paste it into the app, hit **Connect** — validation is instant and the key is **encrypted on your PC** (Windows DPAPI via safeStorage).

That's it. Subsequent asks stream in real time, screenshots are attached natively (Gemini actually sees the pixels), and conversations keep their context in the palette. The key never leaves your machine except to call Google's API directly.

## 📁 Project Structure

```text
├── electron.vite.config.ts        # main / preload / renderer build pipeline
├── electron-builder.yml           # NSIS packaging (x64, per-user)
├── scripts/generate-icons.mjs     # zero-dependency PNG/ICO icon generator
├── build/                         # generated app icon (.ico/.png)
├── resources/                     # tray icon (copied into the installer)
└── src/
    ├── shared/                    # IPC channel names + shared types
    ├── main/                      # Electron main process
    │   ├── index.ts               # app lifecycle, single instance, UA spoofing
    │   ├── tray.ts                # tray icon + native context menu
    │   ├── shortcuts.ts           # global hotkey registration
    │   ├── screenshot.ts          # multi-monitor desktopCapturer capture
    │   ├── startup.ts             # Windows auto-start (login item)
    │   ├── updater.ts             # GitHub Releases update check
    │   ├── store.ts               # electron-store preferences
    │   ├── ipc.ts                 # all IPC wiring
    │   ├── attachment.ts          # pending screenshot attachment state
    │   ├── gemini/
    │   │   ├── session.ts         # hidden Gemini tab: login detect, DOM
    │   │   │                      #   injection, streaming observer
    │   │   └── lens.ts            # Google Lens multipart upload
    │   └── windows/
    │       ├── overlay.ts         # Circle to Search frozen-screen overlays
    │       ├── lensPanel.ts       # slide-out Lens panel + TTS injection
    │       ├── geminiWidget.ts    # floating command palette window
    │       └── settingsWindow.ts  # settings + Google login windows
    ├── preload/                   # contextBridge IPC APIs (sandboxed)
    │   ├── index.ts               # window.gdc bridge
    │   └── geminiPage.ts          # stream bridge for the hidden page
    └── renderer/                  # vanilla TS + Tailwind UIs
        ├── shared/glass.css       # glassmorphism design system
        ├── circle/                # selection canvas overlay
        ├── gemini/                # floating command palette
        ├── settings/              # iOS-style settings panel
        └── lensError/             # Lens panel loading/error shell
```

## 🧠 How It Works

**Circle to Search**
1. Hotkey → `desktopCapturer` grabs every display at native (physical) resolution.
2. Each display gets a transparent always-on-top overlay painting its frozen frame, dimmed.
3. You drag a rectangle; the renderer crops the screenshot on a canvas at full resolution (DPR-corrected).
4. The main process POSTs the PNG as multipart `encoded_image` to `lens.google.com/upload` (fallback: `searchbyimage/upload`), extracts the results URL, and slides a panel in from the right edge of the display where you selected.
5. A MutationObserver-based script decorates text blocks with 🔊 buttons using `window.speechSynthesis`.

**Hold to Gemini**
1. Hotkey → a frameless, transparent always-on-top window animates in above the taskbar of the display under your cursor.
2. Submitting a prompt writes it into the hidden Gemini tab's DOM (contenteditable injection, optional `DataTransfer` screenshot attach), clicks send, and a streaming `MutationObserver` forwards the newest `model-response` text back to the widget character-by-character.
3. Responses settle automatically (1.4 s debounce) with a 2-minute safety timeout.

## 🛠 Troubleshooting & FAQ

<details>
<summary><b>Nothing appears when I open the app (v1.0.0)</b></summary>

v1.0.0 had a packaging bug where every window loaded an empty page — invisible fullscreen overlays could even block mouse input (fixed in **v1.0.1**: windows that fail to render are destroyed automatically, <kbd>Esc</kbd> is enforced at the app level, and manual launches now always show the palette). If you're on v1.0.0, please update.

From v1.0.1 on, a file log is written to `%APPDATA%\Gemini Desktop Companion\logs\main.log` — attach it when reporting issues.
</details>

<details>
<summary><b>An overlay seems stuck / screen feels frozen</b></summary>

<kbd>Esc</kbd> always dismisses the Circle-to-Search freeze, the Gemini palette, and the Lens panel — this is enforced in the app's main process, so it works even if a page failed to render. Clicking anywhere on the frozen screen while Lens results are open also dismisses everything.
</details>

<details>
<summary><b>Google says "This browser or app may not be secure"</b></summary>

The login window uses a Chrome-like user agent and a real Chromium profile, which normally avoids this. If Google still objects, sign in once at [accounts.google.com](https://accounts.google.com) in your normal browser first, then retry — or temporarily use a non-corporate network. Session cookies are stored per-app, so this is only needed once.
</details>

<details>
<summary><b>A hotkey doesn't fire</b></summary>

Another app may own that combination. Settings → Shortcuts shows a red dot for unregistered hotkeys — re-record it with something else.
</details>

<details>
<summary><b>Lens results fail to upload</b></summary>

The panel shows a retry card. Corporate proxies blocking `lens.google.com` are the usual cause; the fallback `searchbyimage` endpoint is tried automatically.
</details>

<details>
<summary><b>Gemini UI changes break sending</b></summary>

The DOM-injection uses several selector fallbacks (`rich-textarea .ql-editor`, `div.ql-editor`, `textarea`, aria-labeled send buttons, keyboard-Enter fallback). If Google ships a breaking change, selectors live in one place: `src/main/gemini/session.ts` (`PAGE_SUBMIT` / `PAGE_OBSERVER`).
</details>

<details>
<summary><b>Windows Defender flags the installer</b></summary>

Expected for unsigned NSIS builds. Verify with the checksums in the release notes, or build from source.
</details>

## 🔒 Privacy

- **No telemetry, no analytics, no backend.** The app talks to exactly three services: Google (Lens + Gemini + login), and GitHub (update check).
- Screenshots are held in memory only and uploaded solely to the Google endpoint you triggered.
- Preferences live in a local `electron-store` JSON file under `%APPDATA%/Gemini Desktop Companion/`.
- Your Google cookies stay inside the app's local Chromium partition and are never synced or exported.

## 🗺 Roadmap

- [ ] True hold-to-talk voice input
- [ ] Per-monitor DPI-perfect lasso (free-form) selection
- [x] Conversation context in the palette · local history export planned
- [ ] Multi-model support (AI Studio / ChatGPT tabs)
- [ ] Code-signed installer + `electron-updater` delta updates

## 📄 License

[MIT](LICENSE) © 2026 Shishir

<div align="center">

**If this saved you a context-switch, consider leaving a ⭐ — it genuinely helps.**

</div>
