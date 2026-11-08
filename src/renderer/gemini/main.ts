import type {
  ApiState,
  Attachment,
  GeminiChunkPayload,
  GeminiErrorPayload,
  GeminiStatusPayload
} from '../../shared/types'

/**
 * Floating Gemini command palette — chat-bubble UI (user prompts right,
 * answers left, copy per answer), powered by the official Gemini API.
 */

const wrap = document.getElementById('wrap') as HTMLDivElement
const responseCard = document.getElementById('response-card') as HTMLElement
const messages = document.getElementById('messages') as HTMLDivElement
const thinking = document.getElementById('thinking') as HTMLElement
const thinkingDetail = document.getElementById('thinking-detail') as HTMLElement
const errorBox = document.getElementById('error-box') as HTMLElement
const errorTitle = document.getElementById('error-title') as HTMLElement
const errorMessage = document.getElementById('error-message') as HTMLElement
const errorRetry = document.getElementById('error-retry') as HTMLButtonElement
const errorSignin = document.getElementById('error-signin') as HTMLButtonElement
const responseFooter = document.getElementById('response-footer') as HTMLElement
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
const pipBtn = document.getElementById('btn-pip') as HTMLButtonElement
const settingsBtn = document.getElementById('btn-settings') as HTMLButtonElement

let attachment: Attachment | null = null
let api: ApiState = { hasKey: false, valid: false, model: '' }
let lastPrompt = ''
let lastError: GeminiErrorPayload | null = null
// Active model bubble being streamed into (null until the first chunk).
let activeBubble: { body: HTMLDivElement; setText: (html: string) => void } | null = null
let lastCopyOk = false
let isBusy = false
const sendArrow = sendBtn.innerHTML
const stopIcon =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'

function setBusy(busy: boolean): void {
  isBusy = busy
  sendBtn.title = busy ? 'Stop generating' : 'Send (Enter)'
  sendBtn.innerHTML = busy ? stopIcon : sendArrow
  sendBtn.disabled = busy
    ? false
    : prompt.value.trim().length === 0 && !attachment
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
refreshState().catch(console.error)
prompt.focus()

window.addEventListener('focus', () => {
  prompt.focus()
  setBusy(false)
  refreshState().catch(console.error)
})
window.gdc.gemini.onShown(() => {
  prompt.focus()
  // CRITICAL: if the palette was closed mid-answer, the request was
  // cancelled without a done/error event — isBusy stayed true and every
  // later submit was swallowed as a "stop" (the "stops responding" bug).
  // Reopening resets the busy state so questions work again.
  setBusy(false)
  hideThinking()
  streamCursor.hidden = true
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

/* ── Chat bubbles ──────────────────────────────────────────────────────── */
function scrollMessages(): void {
  messages.scrollTop = messages.scrollHeight
}

function appendUserBubble(text: string): void {
  const msg = document.createElement('div')
  msg.className = 'msg user'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = text
  msg.appendChild(bubble)
  messages.appendChild(msg)
  responseCard.hidden = false
  scrollMessages()
}

function appendModelBubble(): void {
  const msg = document.createElement('div')
  msg.className = 'msg model'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = ''
  msg.appendChild(bubble)
  messages.appendChild(msg)
  responseCard.hidden = false
  scrollMessages()
  activeBubble = {
    body: bubble,
    setText(html: string): void {
      bubble.innerHTML = html
    }
  }
}

let activeBubbleRaw = ''

/* ── Events from main ──────────────────────────────────────────────────── */
window.gdc.gemini.onAttachment((payload) => setAttachment(payload as Attachment | null))
window.gdc.gemini.onApiChanged((payload) => setApiState(payload as ApiState))
window.gdc.gemini.onStatus((payload) => {
  const p = payload as GeminiStatusPayload
  if ((p as { target?: string }).target !== 'widget') return
  if (p.stage === 'working') {
    setBusy(true)
    showThinking(p.detail ?? 'Thinking…')
  } else if (p.stage === 'streaming') {
    setBusy(true)
    hideThinking()
  }
})
window.gdc.gemini.onChunk((payload) => {
  const p = payload as GeminiChunkPayload
  if ((p as { target?: string }).target !== 'widget') return
  hideThinking()
  hideError()
  responseFooter.hidden = true
  if (!activeBubble) appendModelBubble()
  activeBubbleRaw = p.full
  activeBubble?.setText(renderMarkdown(activeBubbleRaw))
  scrollMessages()
})
window.gdc.gemini.onDone((payload) => {
  if ((payload as { target?: string }).target !== 'widget') return
  setBusy(false)
  streamCursor.hidden = true
  hideThinking()
  responseFooter.hidden = false
})
window.gdc.gemini.onError((payload) => {
  const p = payload as GeminiErrorPayload
  if ((p as { target?: string }).target !== 'widget') return
  lastError = p
  setBusy(false)
  hideThinking()
  streamCursor.hidden = true
  errorBox.hidden = false
  responseFooter.hidden = false
  errorTitle.textContent = p.code === 'NO_API_KEY' ? 'Gemini is not connected' : 'Something went wrong'
  errorMessage.textContent = p.message
  errorSignin.hidden = !p.needsKey
})

/* ── Actions ───────────────────────────────────────────────────────────── */
sendBtn.addEventListener('click', () => {
  if (isBusy) {
    // Stop generating: cancel the request, keep the partial answer.
    void window.gdc.gemini.stop()
    setBusy(false)
    hideThinking()
    streamCursor.hidden = true
    responseFooter.hidden = false
    return
  }
  submit()
})
prompt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
})
prompt.addEventListener('input', autoSize)

attachBtn.addEventListener('click', () => void window.gdc.gemini.attachFromScreen())
removeAttachmentBtn.addEventListener('click', () => void window.gdc.gemini.removeAttachment())
closeBtn.addEventListener('click', () => {
  // X = close the chat: hide the window AND discard the conversation.
  document.body.classList.add('closing')
  setTimeout(() => void window.gdc.gemini.close(), 150)
})
pipBtn.addEventListener('click', () => {
  // PIP = minimize into the floating orb; chat + context keep running.
  document.body.classList.add('closing')
  setTimeout(() => void window.gdc.gemini.pip(), 150)
})
settingsBtn.addEventListener('click', () => void window.gdc.settings.open())
newChatBtn.addEventListener('click', () => {
  messages.innerHTML = ''
  responseCard.hidden = true
  responseFooter.hidden = true
  activeBubble = null
  activeBubbleRaw = ''
  void window.gdc.gemini.newChat()
  prompt.focus()
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

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    pip()
  }
})


async function submit(forceText?: string, isRetry = false): Promise<void> {
  if (isBusy) {
    void window.gdc.gemini.stop()
    setBusy(false)
    hideThinking()
    streamCursor.hidden = true
    responseFooter.hidden = false
    return
  }
  if (!api.hasKey) {
    showError('NO_API_KEY', 'Connect Gemini first — paste a free API key from aistudio.google.com/apikey.')
    return
  }
  const text = (forceText ?? prompt.value).trim()
  if (!text && !attachment && !isRetry) return
  lastPrompt = text || lastPrompt
  // The user prompt becomes a bubble; the answer streams below it.
  appendUserBubble(text || '(screenshot)')
  prompt.value = ''
  autoSize()
  hideError()
  setBusy(true)
  showThinking(attachment ? 'Reading your screenshot…' : 'Thinking…')
  activeBubble = null
  activeBubbleRaw = ''

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
  scrollMessages()
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
  responseCard.hidden = false
}
function hideError(): void {
  errorBox.hidden = true
}

function close(): void {
  document.body.classList.add('closing')
  setTimeout(() => void window.gdc.gemini.close(), 150)
}

function pip(): void {
  document.body.classList.add('closing')
  setTimeout(() => void window.gdc.gemini.pip(), 150)
}

function autoSize(): void {
  prompt.style.height = 'auto'
  prompt.style.height = `${Math.min(prompt.scrollHeight, 130)}px`
  sendBtn.disabled = prompt.value.trim().length === 0 && !attachment
}
sendBtn.disabled = true

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
messages.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const anchor = target.closest('a[data-href]')
  if (anchor) {
    e.preventDefault()
    void window.gdc.openExternal((anchor as HTMLElement).dataset.href ?? '')
  }
})
