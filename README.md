<div align="center">

# ✨ Gemini Desktop Companion

**Android-style *Circle to Search* + *Hold to Gemini* for Windows — a fast, professional AI companion living in your system tray.**

[![Release](https://img.shields.io/github/v/release/Shishir-ip/Gemini-Desktop-Companion?style=flat-square&logo=github&color=a855f7)](https://github.com/Shishir-ip/Gemini-Desktop-Companion/releases)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078d4?style=flat-square&logo=windows11)](#)
[![Built with](https://img.shields.io/badge/built%20with-Electron%20·%20TypeScript%20·%20Vite%20·%20Tailwind-4f8cff?style=flat-square)](#)
[![License](https://img.shields.io/badge/license-MIT-30d158?style=flat-square)](LICENSE)

</div>

---

Gemini Desktop Companion puts two of Android's most-loved AI features on your Windows desktop:

- **Circle to Search** — freeze your screen with a hotkey, drag to select anything, and get Google Lens results in a slide-out panel (with read-aloud). Also streams a **Gemini vision analysis with web-grounded sources**.
- **Hold to Gemini** — a floating chat palette powered by the **official Gemini API**. Ask anything, attach screenshots, switch between models, and get streaming responses with markdown rendering.

No manual API key setup — sign in with Google once via your real browser and you're set. Every surface is a **solid, professional window** with dark and light themes.

---

## 📑 Table of Contents

- [Features](#-features)
- [Screens & Interactions](#-screens--interactions)
- [Default Shortcuts](#-default-shortcuts)
- [Getting Started](#-getting-started)
  - [Install](#install-release-build)
  - [Run from Source](#run-from-source-dev)
  - [Build the Installer](#build-the-installer)
- [Connecting Gemini](#-connecting-gemini)
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
| **🎯 Circle to Search** | One hotkey freezes every monitor behind a selection canvas. Drag a rectangle (pixel-exact, HiDPI-aware) — results slide in from the right edge with **Gemini vision analysis**, **web-grounded sources**, and full **Google Lens** results in your default browser. |
| **💬 Hold to Gemini** | A floating chat palette powered by the **official Gemini API**. Ask anything, attach screenshots, switch between models, and get streaming responses with markdown rendering and code copy buttons. |
| **🔑 Google sign-in** | Sign in once via your **real browser** (Edge/Chrome) — no embedded-browser blocks. The app imports your session securely. Chats stream via the official API. |
| **⏹ Stop button** | Cancel a response mid-stream and keep the partial answer. |
| **🎤 Voice typing** | Click the mic — Windows' own voice typing (Win+H) types straight into the prompt. Works with any language you've configured in Windows, no extra setup. |
| **📋 Code copy** | Every code block in answers has a **Copy** button. |
| **🔀 Model switcher** | Switch between **gemini-3.6-flash** and **gemini-3.5-flash-lite** from the palette footer. |
| **🎨 Dark / Light / Auto themes** | Solid, professional design. No cheap transparency. Select in Settings. |
| **🖥 System tray daemon** | Runs silently in the tray. Left-click opens Home; right-click gives Settings / Check for Updates / Quit. |
| **🚀 Boot persistence** | Optional launch at Windows startup. |
| **⌨️ Custom hotkeys** | Both feature hotkeys are re-recordable in Settings with conflict detection. |
| **📱 Movable palette** | Drag the palette header to position it anywhere on screen. |
| **➖ Minimize to taskbar** | The palette can be minimized like a normal app — chat context persists. |

## 🖥 Screens & Interactions

```text
┌───────────────────────────────────────────────┬─────────────┐
│                                               │  ┌────────┐ │
│   (frozen, dimmed screen)                     │  │  Lens  │ │
│                                               │  │ result │ │
│        ╔═══════════════╗                      │  │  panel │ │
│        ║  your drag    ║  ← Circle to Search  │  │        │ │
│        ╚═══════════════╝                      │  └────────┘ │
│                                               │  slide-out  │
└───────────────────────────────────────────────┴─────────────┘

┌─────────────────────────────────────────────────────────────┐
│  (your desktop)                                             │
│            ╭───────────────────────────────────╮            │
│            │ ✦ Gemini ● ──── 📎 ⚙ ✕           │            │
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
| Dismiss overlay | <kbd>Esc</kbd> / outside click | — |

> **Circle to Search gestures:** *drag* selects a region; a plain *click* searches the **full screen**; while results are open, clicking the frozen screen dismisses everything. In the palette, the 📎 paperclip uses the same selection overlay — a click attaches the whole screen, a drag attaches just that region.

> **The palette header is draggable** — move the palette anywhere on screen. The **— button** minimizes to the Windows taskbar (chat context persists). The **✕ button** closes and deletes the chat.

## 🚀 Getting Started

### Install (release build)

1. Grab **`Gemini-Desktop-Companion-Setup-3.6.1.exe`** from the [latest release](https://github.com/Shishir-ip/Gemini-Desktop-Companion/releases).
2. Run the installer (per-user; desktop + Start Menu shortcuts included).
3. Launch — the **Home window opens** and walks you through everything: features, shortcuts, and connecting Gemini.
4. Sign in with Google via your real browser (takes 30 seconds) — the app picks up your session automatically.

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

## 🔑 Connecting Gemini

Gemini runs on the **official API** (Google AI Studio) — the reliable path with no sign-in walls or bot detection:

1. Open **Settings → Gemini API** (or click the banner in the palette) and click **Get API key** — your browser opens [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Sign in with your Google account and click **Create API key** (free tier included).
3. Copy the key (starts with `AIza`), paste it in the app, hit **Connect** — validation is instant and the key is **encrypted on your PC** (Windows DPAPI via safeStorage).

After that: prompts stream in real time, screenshots are attached natively (`inline_data`), conversations keep their context, and every code block has a copy button.

## 📁 Project Structure

```text
├── electron.vite.config.ts        # main / preload / renderer build pipeline
├── electron-builder.yml           # NSIS packaging (x64, per-user)
├── scripts/generate-icons.mjs     # zero-dependency PNG/ICO icon generator
├── scripts/verify-ui.mjs          # CDP UI verification tool
├── scripts/inspect-gemini.mjs     # Gemini DOM diagnostic tool
├── build/                         # generated app icon (.ico/.png)
├── resources/                     # tray icon (copied into the installer)
└── src/
    ├── shared/                    # IPC channel names + shared types
    ├── main/                      # Electron main process
    │   ├── index.ts               # app lifecycle, single instance, theme
    │   ├── tray.ts                # tray icon + native context menu
    │   ├── shortcuts.ts           # global hotkey registration
    │   ├── screenshot.ts          # multi-monitor desktopCapturer capture
    │   ├── startup.ts             # Windows auto-start (login item)
    │   ├── updater.ts             # GitHub Releases update check
    │   ├── store.ts               # electron-store preferences
    │   ├── logger.ts              # rotating file log
    │   ├── ipc.ts                 # all IPC wiring
    │   ├── browser.ts             # default browser helpers (Lens popup)
    │   ├── attachment.ts          # pending screenshot attachment state
    │   ├── animate.ts             # window bounds tweening
    │   ├── gemini/
    │   │   ├── api.ts             # official Gemini API client (SSE streaming)
    │   │   ├── session.ts         # session shim, UA, permission guards
    │   │   └── lens.ts            # Google Lens multipart upload
    │   └── windows/
    │       ├── overlay.ts         # Circle to Search frozen-screen overlays
    │       ├── resultsPanel.ts    # session-driven Lens results panel
    │       ├── geminiWidget.ts    # floating chat palette window
    │       ├── settingsWindow.ts  # settings window
    │       └── homeWindow.ts      # Home interface window
    ├── preload/                   # contextBridge IPC APIs (sandboxed)
    └── renderer/                  # vanilla TS + Tailwind UIs
        ├── shared/glass.css       # design tokens + theme system
        ├── shared/theme.ts        # theme bootstrap (auto/dark/light)
        ├── circle/                # selection canvas overlay
        ├── gemini/                # floating chat palette
        ├── home/                  # Home interface
        ├── settings/              # Settings panel
        └── orb/                   # Gemini orb (minimized state)
```

## 🧠 How It Works

**Circle to Search**
1. Hotkey → selection overlays appear **instantly** (<100ms) with a dim + "Capturing screen…" hint; the frozen frame is pushed in the moment `desktopCapturer` finishes (~1s).
2. You drag a rectangle; the renderer crops the screenshot on a canvas at full resolution (DPR-corrected).
3. The crop is analyzed by **Gemini vision** (official API) with **Google Search grounding** — the answer includes real web sources rendered as clickable links.
4. "Open in Google Lens" uploads the crop via a **browser-native multipart form POST** from your real browser (Edge/Chrome), so full Lens results open in a standalone popup window.

**Hold to Gemini**
1. Hotkey → a solid 720×480 palette window opens.
2. Submitting a prompt calls the **official Gemini API** via SSE streaming (`streamGenerateContent`).
3. Responses stream token-by-token with markdown rendering and code copy buttons.
4. Conversation context is maintained (last 8 exchanges) via the API's multi-turn format.

## 🛠 Troubleshooting & FAQ

<details>
<summary><b>A hotkey doesn't fire</b></summary>

Another app may own that combination. Settings → Shortcuts shows a red dot for unregistered hotkeys — re-record it with something else.
</details>

<details>
<summary><b>Gemini responses are slow or get rate-limited (429)</b></summary>

The free tier has per-minute and daily quotas. The app auto-retries with backoff (8s/16s/30s). For heavy use, consider a paid-tier API key — the same paste-a-key flow works.
</details>

<details>
<summary><b>An overlay seems stuck or the screen is frozen</b></summary>

<kbd>Esc</kbd> always dismisses the Circle-to-Search freeze, the Gemini palette, and the results panel — enforced in the main process even if a page fails to render.
</details>

<details>
<summary><b>Windows Defender flags the installer</b></summary>

Expected for unsigned NSIS builds. Verify with the checksums in the release notes, or build from source.
</details>

## 🔒 Privacy

- **No telemetry, no analytics, no backend.** The app talks to exactly: Google (Gemini API + Lens + sign-in) and GitHub (update check).
- Screenshots are held in memory only and sent solely to the Gemini API or Google Lens.
- Your API key is encrypted with Windows DPAPI (safeStorage) and stored locally.
- No cookies or sessions are synced or exported.

## 🗺 Roadmap

- [x] Voice input (Windows voice typing via the mic button)
- [ ] Free-form lasso selection
- [ ] Local answer history with full-text search
- [ ] Multi-model support (Claude, GPT, etc.)
- [ ] Code-signed installer + `electron-updater` delta updates

## 📄 License

[MIT](LICENSE) © 2026 Shishir

<div align="center">

**If this saves you a context-switch, consider leaving a ⭐ — it genuinely helps.**

</div>
