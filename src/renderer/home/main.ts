import type { ApiState, SettingsAllResponse } from '../../shared/types'
import { initTheme } from '../shared/theme'

initTheme()

/**
 * Home interface logic: Gemini API connection, "Try it now" launches, and
 * links into Settings. State arrives via the shared settings:get-all channel.
 */

const versionBadge = document.getElementById('version-badge') as HTMLElement
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement
const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement
const btnClose = document.getElementById('btn-close') as HTMLButtonElement
const accountDot = document.getElementById('account-dot') as HTMLElement
const accountTitle = document.getElementById('account-title') as HTMLElement
const accountSub = document.getElementById('account-sub') as HTMLElement
const keyRow = document.getElementById('key-row') as HTMLElement
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement
const saveKeyBtn = document.getElementById('btn-save-key') as HTMLButtonElement
const keyStatus = document.getElementById('key-status') as HTMLElement
const btnSignin = document.getElementById('btn-signin') as HTMLButtonElement
const tryCircle = document.getElementById('try-circle') as HTMLButtonElement
const tryGemini = document.getElementById('try-gemini') as HTMLButtonElement

loadAll().catch(console.error)
void window.gdc.settings.checkApi().then((s) => applyApi(s as ApiState)).catch(() => {})
window.gdc.settings.onApiChanged((payload) => applyApi(payload as ApiState))

async function loadAll(): Promise<void> {
  const current = (await window.gdc.settings.getAll()) as SettingsAllResponse
  versionBadge.textContent = `v${current.version}`
  const hk = current.hotkeys
  // Keep shortcut chips in sync with user preferences.
  const chips = document.querySelectorAll('.kbd-chip')
  const kbd = (acc: string): string =>
    acc
      .split('+')
      .map((p) => `<kbd>${esc(p)}</kbd>`)
      .join('<span class="plus">+</span>')
  if (chips[0]) chips[0].innerHTML = kbd(hk.circleToSearch)
  if (chips[1]) chips[1].innerHTML = kbd(hk.holdToGemini)
  applyApi(current.api)
}

function applyApi(state: ApiState): void {
  accountDot.className = 'login-dot ' + (state.hasKey ? 'ok' : 'off')
  if (state.hasKey) {
    accountTitle.textContent = 'Gemini connected'
    accountSub.textContent = `Streaming via the official API (${state.model}). Conversations keep their context in the palette.`
    keyRow.hidden = true
    keyStatus.hidden = true
    btnSignin.textContent = 'Manage key'
    // Key changes/removal live in Settings — not on the Home surface.
    btnSignin.onclick = () => void window.gdc.settings.open()
  } else {
    accountTitle.textContent = 'Connect Gemini — one free key, 30 seconds'
    accountSub.textContent = '1. Click "Get API key" · 2. Create it in your browser · 3. Paste it here.'
    keyRow.hidden = false
    btnSignin.textContent = 'Get API key'
    btnSignin.onclick = () => void window.gdc.settings.openApiKeys()
  }
}

btnSignin.addEventListener('click', () => void window.gdc.settings.openApiKeys())
btnSettings.addEventListener('click', () => void window.gdc.settings.open())
btnMinimize.addEventListener('click', () => void window.gdc.win.minimize())
btnClose.addEventListener('click', () => window.close())

saveKeyBtn.addEventListener('click', () => void saveKey())
apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void saveKey()
})

async function saveKey(): Promise<void> {
  const key = apiKeyInput.value.trim()
  if (!key) {
    keyStatus.hidden = false
    keyStatus.className = 'key-status err'
    keyStatus.textContent = 'Paste the key first.'
    return
  }
  saveKeyBtn.disabled = true
  keyStatus.hidden = false
  keyStatus.className = 'key-status ok'
  keyStatus.textContent = 'Validating…'
  try {
    const res = (await window.gdc.settings.setApiKey(key)) as {
      ok: boolean
      error?: string
      state: ApiState
    }
    if (res.ok) {
      keyStatus.className = 'key-status ok'
      keyStatus.textContent = 'Connected ✓ — try Hold to Gemini now!'
      applyApi(res.state)
    } else {
      keyStatus.className = 'key-status err'
      keyStatus.textContent = res.error ?? 'Could not validate the key.'
    }
  } catch (err) {
    keyStatus.className = 'key-status err'
    keyStatus.textContent = String(err)
  } finally {
    saveKeyBtn.disabled = false
  }
}

tryCircle.addEventListener('click', () => {
  window.close()
  setTimeout(() => void window.gdc.app.startCircleToSearch(), 120)
})
tryGemini.addEventListener('click', () => {
  window.close()
  setTimeout(() => void window.gdc.app.showGemini(), 120)
})

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
