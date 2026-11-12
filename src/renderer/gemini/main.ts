import type {
  ApiState,
  Attachment,
  GeminiChunkPayload,
  GeminiErrorPayload,
  GeminiStatusPayload
} from '../../shared/types'
import { initTheme } from '../shared/theme'

initTheme()

/**
 * Android-style Gemini pill: a bottom-anchored capsule (+ / input / model
 * chips / send) that grows a scrollable chat sheet above it once a
 * conversation exists. Quick actions appear on an empty chat and right
 * after a screen capture is attached.
 */

const stack = document.getElementById('stack') as HTMLDivElement
const chatSheet = document.getElementById('chat-sheet') as HTMLElement
const messages = document.getElementById('messages') as HTMLDivElement
const thinking = document.getElementById('thinking') as HTMLElement
const thinkingDetail = document.getElementById('thinking-detail') as HTMLElement
const errorBox = document.getElementById('error-box') as HTMLElement
const errorTitle = document.getElementById('error-title') as HTMLElement
const errorMessage = document.getElementById('error-message') as HTMLElement
const errorRetry = document.getElementById('error-retry') as HTMLButtonElement
const errorSignin = document.getElementById('error-signin') as HTMLButtonElement
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
const quickActions = document.getElementById('quick-actions') as HTMLDivElement
const attachmentChip = document.getElementById('attachment-chip') as HTMLElement
const attachmentThumb = document.getElementById('attachment-thumb') as HTMLImageElement
const attachmentSize = document.getElementById('attachment-size') as HTMLElement
const removeAttachmentBtn = document.getElementById('btn-remove-attachment') as HTMLButtonElement
const prompt = document.getElementById('prompt') as HTMLTextAreaElement
const sendBtn = document.getElementById('btn-send') as HTMLButtonElement
const attachBtn = document.getElementById('btn-attach') as HTMLButtonElement
const closeBtn = document.getElementById('btn-close') as HTMLButtonElement
const minimizeBtn = document.getElementById('btn-minimize') as HTMLButtonElement
const settingsBtn = document.getElementById('btn-settings') as HTMLButtonElement

let attachment: Attachment | null = null
let api: ApiState = { hasKey: false, valid: false, model: '' }
let lastPrompt = ''
let hasChat = false
let activeBubble: { body: HTMLDivElement; setText: (html: string) => void } | null = null
let activeBubbleRaw = ''
let isBusy = false
const sendArrow = sendBtn.innerHTML
const stopIcon =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'

function setBusy(busy: boolean): void {
  isBusy = busy
  sendBtn.title = busy ? 'Stop generating' : 'Send (Enter)'
  sendBtn.innerHTML = busy ? stopIcon : sendArrow
  sendBtn.disabled = busy ? false : prompt.value.trim().length === 0 && !attachment
}

/** Quick actions: empty chat, or a capture was just attached. */
function updateQuickActions(): void {
  quickActions.hidden = hasChat && !attachment
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
  // Reopening after a mid-answer close must reset the busy latch.
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
      chatLog: Array<{ role: 'user' | 'model'; text: string; image?: string }>
    }
    setAttachment(state.attachment)
    setApiState(state.api)
    renderChatLog(state.chatLog)
  } catch (err) {
    console.error('getState failed', err)
  }
}

/** Re-render the full chat from the main-process chat log. */
function renderChatLog(log: Array<{ role: 'user' | 'model'; text: string; image?: string }>): void {
  messages.innerHTML = ''
  activeBubble = null
  activeBubbleRaw = ''
  for (const entry of log) {
    if (entry.role === 'user') {
      appendUserBubble(entry.text, entry.image)
    } else {
      appendModelBubble()
      activeBubbleRaw = entry.text
      const bubble = activeBubble as { setText: (html: string) => void } | null
      bubble?.setText(renderMarkdown(activeBubbleRaw))
      finalizeModelBubble()
      decorateCodeBlocks()
    }
  }
  hasChat = log.length > 0
  chatSheet.hidden = !hasChat
  updateQuickActions()
  if (hasChat) scrollMessages()
}

/* ── State rendering ───────────────────────────────────────────────────── */
function setAttachment(next: Attachment | null): void {
  attachment = next
  if (!attachment) {
    attachmentChip.hidden = true
    updateQuickActions()
    return
  }
  attachmentThumb.src = attachment.dataUrl
  const bytes = Math.round((attachment.dataUrl.length * 3) / 4 / 1024)
  attachmentSize.textContent = `PNG · ~${bytes} KB`
  attachmentChip.hidden = false
  updateQuickActions()
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
    prompt.placeholder = 'Connect Gemini to start asking'
    sendBtn.disabled = true
  } else {
    prompt.placeholder = 'Ask Gemini'
    autoSize()
  }
  chip38.classList.toggle('active', state.model === 'gemini-3.6-flash')
  chip35.classList.toggle('active', state.model === 'gemini-3.5-flash-lite')
}

chip38.addEventListener('click', () => void switchModel('gemini-3.6-flash'))
chip35.addEventListener('click', () => void switchModel('gemini-3.5-flash-lite'))

async function switchModel(model: string): Promise<void> {
  const res = (await window.gdc.models.setModel(model)) as { ok: boolean; state: ApiState }
  if (res.ok) setApiState(res.state)
}

/* ── Chat bubbles ──────────────────────────────────────────────────────── */
function scrollMessages(): void {
  messages.scrollTop = messages.scrollHeight
}

function appendUserBubble(text: string, image?: string): void {
  const msg = document.createElement('div')
  msg.className = 'msg user'
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  if (image) {
    const img = document.createElement('img')
    img.className = 'shot-thumb'
    img.src = image
    img.alt = 'attached screenshot'
    img.addEventListener('click', () => window.open(image, '_blank'))
    bubble.appendChild(img)
  }
  if (text) bubble.appendChild(document.createTextNode(text))
  msg.appendChild(bubble)
  messages.appendChild(msg)
  hasChat = true
  chatSheet.hidden = false
  updateQuickActions()
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
  chatSheet.hidden = false
  scrollMessages()
  activeBubble = {
    body: bubble,
    setText(html: string): void {
      bubble.innerHTML = html
    }
  }
}

/** Attach the hover copy tool to a finished model answer. */
function finalizeModelBubble(): void {
  if (!activeBubble) return
  const msg = activeBubble.body.parentElement
  activeBubble = null
  if (!msg || msg.querySelector('.bubble-tools')) return
  const tools = document.createElement('div')
  tools.className = 'bubble-tools'
  const copy = document.createElement('button')
  copy.className = 'bubble-copy'
  copy.textContent = 'Copy'
  copy.addEventListener('click', () => {
    const text = (msg.querySelector('.bubble') as HTMLElement | null)?.innerText ?? ''
    void navigator.clipboard.writeText(text).then(() => {
      copy.textContent = '✓ Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1500)
    })
  })
  tools.appendChild(copy)
  msg.appendChild(tools)
}

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
  if (!activeBubble) appendModelBubble()
  activeBubbleRaw = p.full
  activeBubble?.setText(renderMarkdown(activeBubbleRaw))
  decorateCodeBlocks()
  scrollMessages()
})
window.gdc.gemini.onDone((payload) => {
  if ((payload as { target?: string }).target !== 'widget') return
  setBusy(false)
  streamCursor.hidden = true
  hideThinking()
  finalizeModelBubble()
  decorateCodeBlocks()
})
window.gdc.gemini.onError((payload) => {
  const p = payload as GeminiErrorPayload
  if ((p as { target?: string }).target !== 'widget') return
  setBusy(false)
  hideThinking()
  streamCursor.hidden = true
  errorBox.hidden = false
  chatSheet.hidden = false
  errorTitle.textContent = p.code === 'NO_API_KEY' ? 'Gemini is not connected' : 'Something went wrong'
  errorMessage.textContent = p.message
  errorSignin.hidden = !p.needsKey
})

/* ── Actions ───────────────────────────────────────────────────────────── */
sendBtn.addEventListener('click', () => {
  if (isBusy) {
    void window.gdc.gemini.stop()
    setBusy(false)
    hideThinking()
    streamCursor.hidden = true
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
  document.body.classList.add('closing')
  setTimeout(() => void window.gdc.gemini.close(), 150)
})
minimizeBtn.addEventListener('click', () => {
  void window.gdc.gemini.minimize()
})
settingsBtn.addEventListener('click', () => void window.gdc.settings.open())
newChatBtn.addEventListener('click', () => {
  messages.innerHTML = ''
  chatSheet.hidden = true
  hasChat = false
  activeBubble = null
  activeBubbleRaw = ''
  updateQuickActions()
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
    void window.gdc.gemini.minimize()
  }
})

/* ── Quick actions ─────────────────────────────────────────────────────── */
const QA_TEMPLATES: Record<string, { withImage: string; textPrefix: string }> = {
  explain: { withImage: 'Explain this screenshot in detail.', textPrefix: 'Explain this simply: ' },
  summarize: { withImage: 'Summarize the key points of this screenshot.', textPrefix: 'Summarize this: ' },
  translate: { withImage: 'Translate the text in this screenshot into English.', textPrefix: 'Translate into English: ' },
  solve: { withImage: 'Solve the problem in this screenshot, step by step.', textPrefix: 'Solve step by step: ' },
  code: { withImage: 'Write code based on this screenshot.', textPrefix: 'Write code for: ' }
}
quickActions.querySelectorAll('.qa-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    const qa = QA_TEMPLATES[(chip as HTMLElement).dataset.qa ?? '']
    if (!qa) return
    if (attachment) {
      void submit(qa.withImage)
    } else {
      prompt.value = qa.textPrefix
      autoSize()
      prompt.focus()
    }
  })
})

/* ── Submit ────────────────────────────────────────────────────────────── */
async function submit(forceText?: string, isRetry = false): Promise<void> {
  if (isBusy) {
    void window.gdc.gemini.stop()
    setBusy(false)
    hideThinking()
    streamCursor.hidden = true
    return
  }
  if (!api.hasKey) {
    showError('NO_API_KEY', 'Connect Gemini first — paste a free API key from aistudio.google.com/apikey.')
    return
  }
  const text = (forceText ?? prompt.value).trim()
  if (!text && !attachment && !isRetry) return
  lastPrompt = text || lastPrompt
  appendUserBubble(text || '(screenshot)', attachment?.dataUrl)
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
  errorBox.hidden = true
  chatSheet.hidden = false
  scrollMessages()
}
function hideThinking(): void {
  thinking.hidden = true
}
function showError(code: string, message: string): void {
  errorBox.hidden = false
  chatSheet.hidden = false
  errorTitle.textContent = code === 'NO_API_KEY' ? 'Gemini is not connected' : 'Something went wrong'
  errorMessage.textContent = message
  errorSignin.hidden = code !== 'NO_API_KEY'
}
function hideError(): void {
  errorBox.hidden = true
}

function autoSize(): void {
  prompt.style.height = 'auto'
  prompt.style.height = `${Math.min(prompt.scrollHeight, 76)}px`
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
  text = text.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a data-href="$2">$1</a>')
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

/* ── Code copy buttons ─────────────────────────────────────────────────── */
function decorateCodeBlocks(): void {
  messages.querySelectorAll('pre.code').forEach((el) => {
    const pre = el as HTMLElement
    if (pre.querySelector('.code-copy')) return
    const btn = document.createElement('button')
    btn.className = 'code-copy'
    btn.textContent = 'Copy'
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code')?.textContent ?? pre.textContent ?? ''
      void navigator.clipboard.writeText(code).then(() => {
        btn.textContent = '✓ Copied'
        setTimeout(() => (btn.textContent = 'Copy'), 1600)
      })
    })
    pre.style.position = 'relative'
    pre.appendChild(btn)
  })
}

messages.addEventListener('click', (e) => {
  const target = e.target as HTMLElement
  const anchor = target.closest('a[data-href]')
  if (anchor) {
    e.preventDefault()
    void window.gdc.openExternal((anchor as HTMLElement).dataset.href ?? '')
  }
})

/* ── Self-sizing window: the pill grows upward into a chat ─────────────── */
let lastSentHeight = 0
const reportHeight = (): void => {
  const h = Math.ceil(stack.offsetHeight + 24) // + wrap padding
  if (Math.abs(h - lastSentHeight) >= 2) {
    lastSentHeight = h
    window.gdc.widget.resize(h)
  }
}
new ResizeObserver(reportHeight).observe(stack)
reportHeight()

/* ── Pop-in on every show ──────────────────────────────────────────────── */
window.gdc.gemini.onShown(() => {
  document.body.classList.remove('shown', 'closing')
  void document.body.offsetWidth
  document.body.classList.add('shown')
})
document.body.classList.add('shown')