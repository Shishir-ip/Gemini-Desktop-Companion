import type {
  Attachment,
  GeminiChunkPayload,
  GeminiErrorPayload,
  GeminiStatusPayload,
  LoginState
} from '../../shared/types'

/**
 * Floating Gemini command palette. Streams the background session's answer
 * live; keeps a single conversation per session so history accumulates in
 * the signed-in Google account.
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
const responseFooter = document.getElementById('response-footer') as HTMLElement
const copyBtn = document.getElementById('btn-copy') as HTMLButtonElement
const newChatBtn = document.getElementById('btn-newchat') as HTMLButtonElement
const streamCursor = document.getElementById('stream-cursor') as HTMLElement
const loginDot = document.getElementById('login-dot') as HTMLElement
const attachmentChip = document.getElementById('attachment-chip') as HTMLElement
const attachmentThumb = document.getElementById('attachment-thumb') as HTMLImageElement
const attachmentSize = document.getElementById('attachment-size') as HTMLElement
const removeAttachmentBtn = document.getElementById('btn-remove-attachment') as HTMLButtonElement
const prompt = document.getElementById('prompt') as HTMLTextAreaElement
const sendBtn = document.getElementById('btn-send') as HTMLButtonElement
const attachBtn = document.getElementById('btn-attach') as HTMLButtonElement
const closeBtn = document.getElementById('btn-close') as HTMLButtonElement
const historyBtn = document.getElementById('btn-history') as HTMLButtonElement

let attachment: Attachment | null = null
let login: LoginState = { loggedIn: false, unknown: true }
let lastPrompt = ''
let lastError: GeminiErrorPayload | null = null
let responseText = ''
let hasResponse = false

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
      login: LoginState
    }
    setAttachment(state.attachment)
    setLogin(state.login)
    // Fire-and-forget fresh login probe (also updates Settings if open).
    void window.gdc.settings.checkLogin().then(setLogin).catch(() => {})
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

function setLogin(state: LoginState): void {
  login = state
  loginDot.className = 'login-dot ' + (state.unknown ? 'unknown' : state.loggedIn ? 'ok' : 'off')
  loginDot.title = state.unknown
    ? 'Google session: checking…'
    : state.loggedIn
      ? 'Google account connected — chats save to your history'
      : 'Not signed in — click to sign in'
}

/* ── Events from main ──────────────────────────────────────────────────── */
window.gdc.gemini.onAttachment((payload) => setAttachment(payload as Attachment | null))
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
  errorTitle.textContent = p.code === 'NOT_LOGGED_IN' ? 'Not signed in' : 'Something went wrong'
  errorMessage.textContent = p.message
  errorSignin.hidden = !p.needsLogin
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
historyBtn.addEventListener('click', () => void window.gdc.gemini.openHistory())
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
errorSignin.addEventListener('click', () => void window.gdc.settings.openLogin())

// Click on the empty area around the sheet closes the widget (iOS behavior).
wrap.addEventListener('pointerdown', (e) => {
  if (e.target === wrap) close()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  }
})

let lastCopyOk = false

async function submit(forceText?: string, isRetry = false): Promise<void> {
  const text = (forceText ?? prompt.value).trim()
  if (!text && !attachment && !isRetry) return
  lastPrompt = text || lastPrompt
  prompt.value = ''
  autoSize()
  hideError()
  showThinking(attachment ? 'Uploading screenshot…' : 'Thinking…')

  // Ensure the response card is visible before first chunk arrives.
  if (!hasResponse) stream.innerHTML = ''
  responseCard.hidden = false
  scrollToBottom()

  try {
    await window.gdc.gemini.submit(text)
  } catch (err) {
    hideThinking()
    showError('SUBMIT_FAILED', 'Could not reach Gemini. Make sure you are signed in and try again.')
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
  lastError = { code, message, needsLogin: code === 'NOT_LOGGED_IN' }
  errorBox.hidden = false
  errorTitle.textContent = code === 'NOT_LOGGED_IN' ? 'Not signed in' : 'Something went wrong'
  errorMessage.textContent = message
  errorSignin.hidden = !lastError.needsLogin
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
  // Bullet lists
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
  // Numbered lists
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
