import type { LoginState, SettingsAllResponse } from '../../shared/types'

/**
 * Home interface logic: account status, "Try it now" launches, and links
 * into Settings. State arrives via the shared settings:get-all channel and
 * login pushes.
 */

const versionBadge = document.getElementById('version-badge') as HTMLElement
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement
const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement
const btnClose = document.getElementById('btn-close') as HTMLButtonElement
const accountDot = document.getElementById('account-dot') as HTMLElement
const accountTitle = document.getElementById('account-title') as HTMLElement
const accountSub = document.getElementById('account-sub') as HTMLElement
const btnSignin = document.getElementById('btn-signin') as HTMLButtonElement
const tryCircle = document.getElementById('try-circle') as HTMLButtonElement
const tryGemini = document.getElementById('try-gemini') as HTMLButtonElement

let current: SettingsAllResponse | null = null

loadAll().catch(console.error)
void window.gdc.settings.checkLogin().then((s) => applyLogin(s as LoginState)).catch(() => {})
window.gdc.settings.onLoginChanged((payload) => applyLogin(payload as LoginState))

async function loadAll(): Promise<void> {
  current = (await window.gdc.settings.getAll()) as SettingsAllResponse
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
  applyLogin(current.login)
}

function applyLogin(state: LoginState): void {
  accountDot.className = 'login-dot ' + (state.unknown ? 'unknown' : state.loggedIn ? 'ok' : 'off')
  if (state.unknown) {
    accountTitle.textContent = 'Checking Google session…'
    accountSub.textContent = 'Chats save to your Gemini account history.'
    btnSignin.hidden = true
  } else if (state.loggedIn) {
    accountTitle.textContent = 'Google account connected'
    accountSub.textContent = 'Every chat is saved to your Gemini history. You are all set.'
    btnSignin.hidden = true
  } else {
    accountTitle.textContent = 'One step left: sign in with Google'
    accountSub.textContent = 'Your real browser opens for the sign-in — the app picks the session up automatically.'
    btnSignin.hidden = false
  }
}

btnSignin.addEventListener('click', () => void window.gdc.settings.openLogin())
btnSettings.addEventListener('click', () => void window.gdc.settings.open())
btnMinimize.addEventListener('click', () => void window.gdc.win.minimize())
btnClose.addEventListener('click', () => window.close())

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
