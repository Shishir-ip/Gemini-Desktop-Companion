import type {
  LoginState,
  RegistrationStatus,
  SetHotkeysResponse,
  SettingsAllResponse
} from '../../shared/types'

/**
 * iOS-style Settings panel: live hotkey recorders, startup toggle,
 * Google account status, and update checks.
 */

const versionBadge = document.getElementById('version-badge') as HTMLElement
const btnMinimize = document.getElementById('btn-minimize') as HTMLButtonElement
const btnClose = document.getElementById('btn-close') as HTMLButtonElement

const hkCircle = document.getElementById('hk-circle') as HTMLButtonElement
const hkGemini = document.getElementById('hk-gemini') as HTMLButtonElement
const hkCircleStatus = document.getElementById('hk-circle-status') as HTMLElement
const hkGeminiStatus = document.getElementById('hk-gemini-status') as HTMLElement
const hotkeyNote = document.getElementById('hotkey-note') as HTMLElement

const toggleStartup = document.getElementById('toggle-startup') as HTMLElement
const accountTitle = document.getElementById('account-title') as HTMLElement
const accountSub = document.getElementById('account-sub') as HTMLElement
const btnLogin = document.getElementById('btn-login') as HTMLButtonElement
const btnHistory = document.getElementById('btn-history') as HTMLButtonElement
const btnUpdates = document.getElementById('btn-updates') as HTMLButtonElement
const updateSub = document.getElementById('update-sub') as HTMLElement
const btnGithub = document.getElementById('btn-github') as HTMLButtonElement

const GITHUB_URL = 'https://github.com/Shishir-ip/Gemini-Desktop-Companion'

/* ── Title bar ─────────────────────────────────────────────────────────── */
btnClose.addEventListener('click', () => void window.gdc.win.close())
btnMinimize.addEventListener('click', () => void window.gdc.win.minimize())

/* ── Load current settings ─────────────────────────────────────────────── */
let current: SettingsAllResponse | null = null

loadAll().catch(console.error)

async function loadAll(): Promise<void> {
  current = (await window.gdc.settings.getAll()) as SettingsAllResponse
  versionBadge.textContent = `v${current.version}${current.isDev ? ' · dev' : ''}`
  hkCircle.textContent = formatAccelerator(current.hotkeys.circleToSearch)
  hkGemini.textContent = formatAccelerator(current.hotkeys.holdToGemini)
  setStartupToggle(current.startup)
  applyRegistration(current.registration)
  setLogin(current.login)
  void window.gdc.settings.checkLogin().then(setLogin).catch(() => {})
}

function applyRegistration(reg: RegistrationStatus): void {
  setStatus(hkCircleStatus, reg.circleToSearch, 'Shortcut active — conflict with another app')
  setStatus(hkGeminiStatus, reg.holdToGemini, 'Shortcut active — conflict with another app')
  hkCircle.classList.toggle('conflict', !reg.circleToSearch)
  hkGemini.classList.toggle('conflict', !reg.holdToGemini)
}

function setStatus(el: HTMLElement, ok: boolean, errTitle: string): void {
  el.className = 'hotkey-status ' + (ok ? 'ok' : 'err')
  el.title = ok ? 'Registered' : errTitle
}

/* ── Hotkey recorders ──────────────────────────────────────────────────── */
const recorders = new Map<string, { btn: HTMLButtonElement; status: HTMLElement }>([
  ['circleToSearch', { btn: hkCircle, status: hkCircleStatus }],
  ['holdToGemini', { btn: hkGemini, status: hkGeminiStatus }]
])
let recordingFor: string | null = null
let draft: { circleToSearch: string; holdToGemini: string } | null = null

for (const [key, { btn }] of recorders) {
  btn.addEventListener('click', () => startRecording(key))
}

function startRecording(target: string): void {
  if (recordingFor === target) return
  commitDraft()
  recordingFor = target
  const { btn } = recorders.get(target)!
  btn.classList.add('recording')
  btn.textContent = 'Press keys…'
}

function stopRecording(): void {
  if (!recordingFor) return
  const { btn } = recorders.get(recordingFor)!
  btn.classList.remove('recording')
  recordingFor = null
  refreshButtons()
}

window.addEventListener('keydown', (e) => {
  if (!recordingFor) return
  e.preventDefault()
  e.stopPropagation()

  if (e.key === 'Escape') {
    stopRecording()
    return
  }

  const accelerator = eventToAccelerator(e)
  if (!accelerator) return

  const target = recordingFor
  const otherKey = target === 'circleToSearch' ? 'holdToGemini' : 'circleToSearch'
  const otherValue =
    draft?.[otherKey as 'circleToSearch' | 'holdToGemini'] ??
    (current
      ? current.hotkeys[otherKey as 'circleToSearch' | 'holdToGemini']
      : '')

  if (accelerator.toLowerCase() === otherValue.toLowerCase()) {
    flashNote('That combination is already used by the other shortcut. Pick another.', 'warning')
    return
  }

  draft = {
    circleToSearch:
      target === 'circleToSearch'
        ? accelerator
        : (draft?.circleToSearch ?? current?.hotkeys.circleToSearch ?? ''),
    holdToGemini:
      target === 'holdToGemini'
        ? accelerator
        : (draft?.holdToGemini ?? current?.hotkeys.holdToGemini ?? '')
  }

  const { btn } = recorders.get(target)!
  btn.classList.remove('recording')
  btn.textContent = formatAccelerator(accelerator)
  recordingFor = null
  void commitDraft()
})

window.addEventListener('blur', () => stopRecording())

async function commitDraft(): Promise<void> {
  if (!draft) return
  const payload = draft
  draft = null
  const res = (await window.gdc.settings.setHotkeys(payload)) as SetHotkeysResponse
  if (res.ok && current && res.registration) {
    current.hotkeys = payload
    current.registration = res.registration
    applyRegistration(res.registration)
    refreshButtons()
    flashNote(null)
  } else {
    refreshButtons()
    flashNote(res.error ?? 'Could not save shortcuts.', 'error')
  }
}

function refreshButtons(): void {
  if (!current) return
  hkCircle.textContent = formatAccelerator(
    draft?.circleToSearch ?? current.hotkeys.circleToSearch
  )
  hkGemini.textContent = formatAccelerator(
    draft?.holdToGemini ?? current.hotkeys.holdToGemini
  )
}

function flashNote(message: string | null, kind: 'warning' | 'error' = 'warning'): void {
  if (!message) {
    hotkeyNote.hidden = true
    return
  }
  hotkeyNote.hidden = false
  hotkeyNote.textContent = message
  hotkeyNote.style.color = kind === 'error' ? 'var(--danger)' : 'var(--warning)'
}

/** KeyboardEvent → Electron accelerator string ("Ctrl+Shift+C"). */
function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = normalizeKey(e)
  if (!key) return null
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')

  const needsModifier = !/^(F1[0-9]?|[1-9]|F[1-9])$/.test(key)
  if (needsModifier && mods.length === 0) return null
  return [...mods, key].join('+')
}

function normalizeKey(e: KeyboardEvent): string | null {
  const k = e.key
  if (/^[a-z]$/i.test(k)) return k.toUpperCase()
  if (/^[0-9]$/.test(k)) return k
  if (/^F([1-9]|1[0-9])$/.test(k)) return k
  const named: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    Plus: '+',
    Minus: '-'
  }
  if (named[k]) return named[k]
  if (k.length === 1 && /[!@#$%^&*()_+=[\]{};':"\\|,.<>/?`~]/.test(k)) return null
  return null
}

function formatAccelerator(acc: string): string {
  return acc.replace(/\+/g, ' + ')
}

/* ── Startup toggle ────────────────────────────────────────────────────── */
function setStartupToggle(on: boolean): void {
  toggleStartup.classList.toggle('on', on)
  toggleStartup.setAttribute('aria-checked', String(on))
}

async function flipStartup(): Promise<void> {
  const next = !toggleStartup.classList.contains('on')
  setStartupToggle(next)
  const applied = (await window.gdc.settings.setStartup(next)) as boolean
  setStartupToggle(applied)
}

toggleStartup.addEventListener('click', () => void flipStartup())
toggleStartup.addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    void flipStartup()
  }
})

/* ── Account ───────────────────────────────────────────────────────────── */
function setLogin(state: LoginState): void {
  if (state.unknown) {
    accountTitle.textContent = 'Checking Google session…'
    accountSub.textContent = 'Making sure your Gemini session is alive.'
    btnLogin.textContent = 'Sign in'
    btnLogin.disabled = true
  } else if (state.loggedIn) {
    accountTitle.textContent = 'Google account connected'
    accountSub.textContent =
      'Every chat — typed prompts and screen selections — is saved to your Gemini history.'
    btnLogin.textContent = 'Manage session'
    btnLogin.disabled = false
  } else {
    accountTitle.textContent = 'Not signed in'
    accountSub.textContent = 'Sign in with Google so chats save to your account history.'
    btnLogin.textContent = 'Sign in'
    btnLogin.disabled = false
  }
}

btnLogin.addEventListener('click', () => void window.gdc.settings.openLogin())
btnHistory.addEventListener('click', () => void window.gdc.settings.openHistory())

window.gdc.settings.onLoginChanged((payload) => setLogin(payload as LoginState))

/* ── About ─────────────────────────────────────────────────────────────── */
btnUpdates.addEventListener('click', () => {
  updateSub.textContent = 'Checking…'
  btnUpdates.disabled = true
  void window.gdc.settings.checkUpdates().finally(() => {
    btnUpdates.disabled = false
    updateSub.textContent = "You're on the latest release channel"
  })
})
btnGithub.addEventListener('click', () => void window.gdc.openExternal(GITHUB_URL))
