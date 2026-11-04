import type { ApiState, GeminiChunkPayload, GeminiErrorPayload, GeminiStatusPayload } from '../../shared/types'

/**
 * Circle-to-Search results panel: streams a Gemini vision analysis of the
 * cropped region. "Open in Google Lens" is the classic fallback.
 */

const status = document.getElementById('status') as HTMLElement
const body = document.getElementById('body') as HTMLDivElement
const cropThumb = document.getElementById('crop-thumb') as HTMLImageElement
const btnLens = document.getElementById('btn-lens') as HTMLButtonElement
const btnClose = document.getElementById('btn-close') as HTMLButtonElement

let full = ''

init().catch((err) => {
  setStatus(`Something went wrong: ${String(err)}`, 'err')
})

async function init(): Promise<void> {
  const crop = await window.gdc.lens.getCrop()
  if (!crop) {
    setStatus('No selection found.', 'err')
    return
  }
  cropThumb.src = crop

  // Kick off the analysis (events arrive via the shared Gemini channels).
  void window.gdc.lens.analyze()

  btnLens.addEventListener('click', () => {
    btnLens.disabled = true
    setStatus('Opening Google Lens…')
    void window.gdc.lens.openWeb().then((ok) => {
      if (!ok) {
        btnLens.disabled = false
        setStatus('Lens upload failed — try again.', 'err')
      }
    })
  })
  btnClose.addEventListener('click', () => void window.gdc.lens.closePanel())
}

window.gdc.gemini.onStatus((payload) => {
  const p = payload as GeminiStatusPayload
  if ((p as { target?: string }).target !== 'results') return
  if (p.stage === 'working' && full.length === 0) {
    setStatus(p.detail ?? 'Thinking…')
  }
})
window.gdc.gemini.onChunk((payload) => {
  const p = payload as GeminiChunkPayload
  if ((p as { target?: string }).target !== 'results') return
  setStatus('Gemini answer', 'ok')
  if (p.append) full += p.append
  else full = p.full
  body.innerHTML = renderMarkdown(full)
  decorateTts()
  body.scrollTop = body.scrollHeight
})
window.gdc.gemini.onDone((payload) => {
  if ((payload as { target?: string }).target !== 'results') return
  setStatus('Done', 'ok')
})
window.gdc.gemini.onError((payload) => {
  const p = payload as GeminiErrorPayload
  if ((p as { target?: string }).target !== 'results') return
  setStatus(p.message, 'err')
  body.innerHTML = `<div style="color:var(--danger);font-weight:600;margin-bottom:6px;">${
    p.code === 'NO_API_KEY' ? 'Connect Gemini first' : 'Something went wrong'
  }</div><div style="color:var(--text-secondary);font-size:12.5px;line-height:1.5;">${escapeHtml(
    p.message
  )}</div>`
})

function setStatus(text: string, kind?: 'ok' | 'err'): void {
  status.textContent = text
  status.className = 'status ' + (kind ?? '')
}

function decorateTts(): void {
  // Speaker button per paragraph so any part can be read aloud.
  body.querySelectorAll('p.para').forEach((p) => {
    const old = p.querySelector('.tts-btn')
    if (old) old.remove()
    const text = (p.textContent || '').trim()
    if (text.length < 12) return
    const btn = document.createElement('button')
    btn.className = 'tts-btn'
    btn.textContent = '🔊'
    btn.title = 'Read aloud'
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      try {
        const synth = window.speechSynthesis
        if (btn.textContent === '⏹') {
          synth.cancel()
          btn.textContent = '🔊'
          return
        }
        synth.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.rate = 1
        u.onend = u.onerror = () => (btn.textContent = '🔊')
        btn.textContent = '⏹'
        synth.speak(u)
      } catch { /* ignore */ }
    })
    p.appendChild(btn)
  })
}

function escapeHtml(src: string): string {
  return src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderMarkdown(src: string): string {
  let text = escapeHtml(src)
  text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, _lang, code) => {
    return `<pre class="code"><code>${String(code).replace(/\n+$/, '')}</code></pre>`
  })
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>')
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  text = text.replace(/^#{1,4}\s+(.+)$/gm, '<h3>$1</h3>')
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
  text = text.replace(/\n{2,}/g, '<br class="pbreak"><br class="pbreak">')
  // Wrap content between double breaks into paragraphs for per-paragraph TTS.
  const segments = text.split(/(?:<br class="pbreak">)+/)
  text = segments
    .map((seg) => (seg.trim() ? `<p class="para">${seg}</p>` : ''))
    .join('')
  return text
}
