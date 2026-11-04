import type {
  ApiState,
  Attachment,
  GeminiChunkPayload,
  GeminiErrorPayload,
  GeminiStatusPayload
} from '../../shared/types'

/**
 * Floating Gemini command palette, powered by the official Gemini API
 * (streaming SSE, native screenshot input, in-app conversation context).
 */

const wrap = document.getElementById('wrap') as HTMLDivElement
const responseCard = document.getElementById('response-card') as HTMLElement
const thinking = document.getElementById('thinking') as HTMLElement
const thinkingDetail = document.getElementById('thinking-detail') as HTMLElement
const stream = document.getElementById('stream') as HTMLDivElement
const errorBox = document.getElementById('error-box') as HTMLElement
const errorTitle = document.getElementById('error-title') as HTMLElement
const errorMessage = document.getElementById('error-message') as HTMLElement
const errorRetry = document.getElementById('error-retry') as HTMLButtonElement
const errorSignin = document.getElementById('error-signin') as HTMLButtonElement
const errorOpenGemini = document.getElementById('error-opengemini') as HTMLButtonElement
const responseFooter = document.getElementById('response-footer') as HTMLElement
const copyBtn = document.getElementById('btn-copy') as HTMLButtonElement
const newChatBtn = document.getElementById('btn-newchat') as HTMLButtonElement
const streamCursor = document.getElementById('stream-cursor') as HTMLElement
const apiDot = document.getElementById('api-dot') as HTMLElement
const apiBanner = document.getElementById('api-banner') as HTMLElement
const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement
const saveKeyBtn = document.getElementById('btn-save-key') as HTMLButtonElement
const keyStatus = document.getElementById('api-key-status') as HTMLElement
const chip38 = document.getElementById('chip-38') as HTMLButtonElement
const chip35 = document.getElementById('chip-35') as HTMLButtonElement
const getKeyBtn = document.getElementById('btn-getkey') as HTMLButtonElement
const attachmentChip = document.getElementById('attachment-chip') as HTMLElement
const attachmentThumb = document.getElementById('attachment-thumb') as HTMLImageElement
const attachmentSize = document.getElementById('attachment-size') as HTMLElement
const removeAttachmentBtn = document.getElementById('btn-remove-attachment') as HTMLButtonElement
const prompt = document.getElementById('prompt') as HTMLTextAreaElement
const sendBtn = document.getElementById('btn-send') as HTMLButtonElement
const attachBtn = document.getElementById('btn-attach') as HTMLButtonElement
const closeBtn = document.getElementById('btn-close') as HTMLButtonElement
const settingsBtn = document.getElementById('btn-settings') as HTMLButtonElement

let attachment: Attachment | null = null
let api: ApiState = { hasKey: false, valid: false, model: '' }
let lastPrompt = ''
let lastError: GeminiErrorPayload | null = null
let responseText = ''
let hasResponse = false
let lastCopyOk = false

/* ── Boot ──────────────────────────────────────────────────────────────── */
refreshState().catch(console.error)
prompt.focus()

window.addEventListener('focus', () => {
  prompt.focus()
  refreshState().catch(console.error)
})

async function refreshState(): Promise<void> {
  try {
    const state = (await window.gdc.gemini.getState()) as {
      attachment: Attachment | null
      api: ApiState
    }
    setAttachment(state.attachment)
    setApiState(state.api)
  } catch (err) {
    console.error('getState failed', err)
  }
}

/* ── State rendering ───────────────────────────────────────────────────── */
function setAttachment(next: Attachment | null): void {
  attachment = next
  if (!attachment) {
    attachmentChip.hidden = true
    return
  }
  attachmentThumb.src = attachment.dataUrl
  const bytes = Math.round((attachment.dataUrl.length * 3) / 4 / 1024)
  attachmentSize.textContent = `PNG · ~${bytes} KB`
  attachmentChip.hidden = false
}

function setApiState(state: ApiState): void {
  api = state
  apiDot.className = 'login-dot ' + (state.hasKey && state.valid ? 'ok' : 'off')
  apiDot.title = state.hasKey
    ? `Gemini API connected (${state.model})`
    : 'Gemini not connected — paste a free API key'
  apiBanner.hidden = state.hasKey
  prompt.disabled = !state.hasKey
  if (!state.hasKey) {
    prompt.placeholder = 'Connect Gemini to start asking…'
    sendBtn.disabled = true
  } else {
    prompt.placeholder = 'Ask Gemini anything…'
    autoSize()
  }
  // Model chips reflect the active model.
  chip38.classList.toggle('active', state.model === 'gemini-3.8-flash')
  chip35.classList.toggle('active', state.model === 'gemini-3.5-flash-lite')
}

chip38.addEventListener('click', () => void switchModel('gemini-3.8-flash'))
chip35.addEventListener('click', () => void switchModel('gemini-3.5-flash-lite'))

async function switchModel(model: string): Promise<void> {
  const res = (await window.gdc.models.setModel(model)) as {
    ok: boolean
    state: ApiState
  }
  if (res.ok) setApiState(res.state)
}

/* ── Events from main ──────────────────────────────────────────────────── */
window.gdc.gemini.onAttachment((payload) => setAttachment(payload as Attachment | null))
window.gdc.gemini.onApiChanged((payload) => setApiState(payload as ApiState))
window.gdc.gemini.onStatus((payload) => {
  const p = payload as GeminiStatusPayload
  if (p.stage === 'working') {
    showThinking(p.detail ?? 'Thinking…')
  } else if (p.stage === 'streaming') {
    hideThinking()
  }
})
window.gdc.gemini.onChunk((payload) => {
  const p = payload as GeminiChunkPayload
  hasResponse = true
  hideThinking()
  hideError()
  streamCursor.hidden = false
  responseFooter.hidden = true
  if (p.append) {
    responseText += p.append
  } else {
    responseText = p.full
  }
  stream.innerHTML = renderMarkdown(responseText)
  scrollToBottom()
})
window.gdc.gemini.onDone(() => {
  streamCursor.hidden = true
  responseFooter.hidden = false
  hideThinking()
})
window.gdc.gemini.onError((payload) => {
  const p = payload as GeminiErrorPayload
  lastError = p
  hideThinking()
  streamCursor.hidden = true
  errorBox.hidden = false
  responseFooter.hidden = true
  errorTitle.textContent = p.code === 'NO_API_KEY' ? 'Gemini is not connected' : 'Something went wrong'
  errorMessage.textContent = p.message
  errorSignin.hidden = !p.needsKey
  errorOpenGemini.hidden = false
})

/* ── Actions ───────────────────────────────────────────────────────────── */
sendBtn.addEventListener('click', () => submit())
prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
})
prompt.addEventListener('input', autoSize)

attachBtn.addEventListener('click', () => void window.gdc.gemini.attachFromScreen())
removeAttachmentBtn.addEventListener('click', () => void window.gdc.gemini.removeAttachment())
closeBtn.addEventListener('click', close)
settingsBtn.addEventListener('click', () => void window.gdc.settings.open())
newChatBtn.addEventListener('click', () => {
  responseText = ''
  hasResponse = false
  responseFooter.hidden = true
  responseCard.hidden = true
  void window.gdc.gemini.newChat()
  prompt.focus()
})
copyBtn.addEventListener('click', () => {
  void navigator.clipboard.writeText(responseText).then(() => {
    copyBtn.textContent = '✓ Copied'
    lastCopyOk = true
    setTimeout(() => {
      copyBtn.textContent = 'Copy'
      lastCopyOk = false
    }, 1600)
  })
})
errorRetry.addEventListener('click', () => {
  hideError()
  if (lastPrompt) submit(lastPrompt, true)
})
errorSignin.addEventListener('click', () => {
  hideError()
  apiBanner.hidden = false
  apiKeyInput.focus()
})
errorOpenGemini.addEventListener('click', () => {
  void window.gdc.openExternal('https://aistudio.google.com/apikey')
})
getKeyBtn.addEventListener('click', () => {
  void window.gdc.openExternal('https://aistudio.google.com/apikey')
})
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
      keyStatus.textContent = 'Connected ✓'
      setApiState(res.state)
      setTimeout(() => {
        apiBanner.hidden = true
        prompt.focus()
      }, 700)
    } else {
      keyStatus.className = 'key-status err'
      keyStatus.textContent = res.error ?? 'Could not validate the key.'
      setApiState(res.state)
    }
  } catch (err) {
    keyStatus.className = 'key-status err'
    keyStatus.textContent = String(err)
  } finally {
    saveKeyBtn.disabled = false
  }
}

// Click on the empty area around the sheet closes the widget (iOS behavior).
// NOTE: the window is OS-level click-through outside the glass cards, so
// this only fires in the narrow gap between the two cards.
wrap.addEventListener('pointerdown', (e) => {
  if (e.target === wrap) close()
})

/* ── Click-through: invisible regions must never block the desktop ─────── */
let ignoringMouse = true

function applyIgnoreMouse(ignore: boolean): void {
  if (ignore === ignoringMouse) return
  ignoringMouse = ignore
  void window.gdc.widget.setIgnoreMouse(ignore)
}

document.addEventListener('pointermove', (e) => {
  const el = e.target as Element | null
  const overCard = !!(el && typeof el.closest === 'function' && el.closest('.glass-card'))
  applyIgnoreMouse(!overCard)
})
// When the pointer leaves the window entirely, go back to click-through.
document.addEventListener('pointerout', (e) => {
  if (!e.relatedTarget) applyIgnoreMouse(true)
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
})

async function submit(forceText?: string, isRetry = false): Promise<void> {
  if (!api.hasKey) {
    showError('NO_API_KEY', 'Connect Gemini first — paste a free API key from aistudio.google.com/apikey.')
    return
  }
  const text = (forceText ?? prompt.value).trim()
  if (!text && !attachment && !isRetry) return
  lastPrompt = text || lastPrompt
  prompt.value = ''
  autoSize()
  hideError()
  showThinking(attachment ? 'Reading your screenshot…' : 'Thinking…')

  if (!hasResponse) stream.innerHTML = ''
  responseCard.hidden = false
  scrollToBottom()

  try {
    await window.gdc.gemini.submit(text)
  } catch (err) {
    hideThinking()
    showError('SUBMIT_FAILED', 'Could not reach the Gemini API. Check your connection and try again.')
    console.error(err)
  }
}

function showThinking(detail: string): void {
  thinkingDetail.textContent = detail
  thinking.hidden = false
  streamCursor.hidden = true
  responseFooter.hidden = true
  errorBox.hidden = true
  responseCard.hidden = false
  scrollToBottom()
}
function hideThinking(): void {
  thinking.hidden = true
}
function showError(code: string, message: string): void {
  lastError = { code, message, needsKey: code === 'NO_API_KEY' }
  errorBox.hidden = false
  errorTitle.textContent = code === 'NO_API_KEY' ? 'Gemini is not connected' : 'Something went wrong'
  errorMessage.textContent = message
  errorSignin.hidden = !lastError.needsKey
  errorOpenGemini.hidden = code === 'NO_API_KEY'
  responseCard.hidden = false
}
function hideError(): void {
  errorBox.hidden = true
}

function close(): void {
  document.body.classList.add('closing')
  setTimeout(() => void window.gdc.gemini.close(), 150)
}

function autoSize(): void {
  prompt.style.height = 'auto'
  prompt.style.height = `${Math.min(prompt.scrollHeight, 130)}px`
  sendBtn.disabled = prompt.value.trim().length === 0 && !attachment
}
sendBtn.disabled = true

function scrollToBottom(): void {
  stream.scrollTop = stream.scrollHeight
}

/* ── Tiny markdown renderer (escape-first, then transform) ─────────────── */
function escapeHtml(src: string): string {
  return src
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarkdown(src: string): string {
  let text = escapeHtml(src)

  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre class="code"><code>${String(code).replace(/\n+$/, '')}</code></pre>`
  })
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s.,;:!?)])/g, '$1<em>$2</em>')
  text = text.replace(/^#{1,4}\s+(.+)$/gm, '<h3>$1</h3>')
  text = text.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a data-href="$2">$1</a>'
  )
  text = text.replace(
    /(?:^|\n)((?:[-*•]\s+[^\n]+\n?)+)/g,
    (_m, block: string) =>
      '<ul>' +
      block
        .trim()
        .split('\n')
        .map((l) => `<li>${l.replace(/^[-*•]\s+/, '')}</li>`)
        .join('') +
      '</ul>'
  )
  text = text.replace(
    /(?:^|\n)((?:\d+[.)]\s+[^\n]+\n?)+)/g,
    (_m, block: string) =>
      '<ol>' +
      block
        .trim()
        .split('\n')
        .map((l) => `<li>${l.replace(/^\d+[.)]\s+/, '')}</li>`)
        .join('') +
      '</ol>'
  )
  text = text.replace(/\n{2,}/g, '<br><br>')
  text = text.replace(/\n/g, '<br>')
  return text
}

// Links open in the user's real browser.
stream.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const anchor = target.closest('a[data-href]')
  if (anchor) {
    e.preventDefault()
    void window.gdc.openExternal((anchor as HTMLElement).dataset.href ?? '')
  }
})
