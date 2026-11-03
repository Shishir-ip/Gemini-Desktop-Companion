import type { Attachment } from '../shared/types'
import { IPC } from '../shared/ipc'
import { forwardGeminiEvent } from './windows/geminiWidget'

/**
 * Singleton holding the most recent screenshot attachment destined for the
 * Gemini prompt. Set by the "attach" crop flow, consumed by a submission.
 */

let pending: Attachment | null = null

export function setPendingAttachment(attachment: Attachment): void {
  pending = attachment
  notifyWidget()
}

export function getPendingAttachment(): Attachment | null {
  return pending
}

export function clearPendingAttachment(): void {
  if (pending === null) return
  pending = null
  notifyWidget()
}

function notifyWidget(): void {
  forwardGeminiEvent(IPC.GeminiAttachmentChanged, pending)
}
