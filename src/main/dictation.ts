import { spawn } from 'node:child_process'
import { log } from './logger'

/**
 * Windows voice typing for the chat palette.
 *
 * Why not the Web Speech API? Chromium's SpeechRecognition requires Google's
 * speech-service API key, which Electron builds do not embed — start() always
 * dies with a 'network' error (electron/electron#2831). No switch fixes it.
 *
 * The reliable procedure on Windows is the OS's own dictation: pressing
 * Win+H opens "Voice typing", which types spoken words into the focused text
 * field. It works with any language the user has configured, needs no API
 * key, and lands text in our prompt box exactly like real typing.
 *
 * We synthesize the keystroke with keybd_event (P/Invoke from PowerShell —
 * built into Windows, no native npm dependency). The prompt textarea is
 * focused by the renderer before this runs, so dictation anchors to it.
 */

const SEND_WIN_H_PS = `
$def = @'
using System;
using System.Runtime.InteropServices;
public static class Kb {
  [DllImport("user32.dll")]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'@
Add-Type -TypeDefinition $def
$VK_LWIN = 0x5B; $VK_H = 0x48; $KEYUP = 0x2
[Kb]::keybd_event($VK_LWIN, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Kb]::keybd_event($VK_H, 0, 0, [UIntPtr]::Zero)
[Kb]::keybd_event($VK_H, 0, $KEYUP, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[Kb]::keybd_event($VK_LWIN, 0, $KEYUP, [UIntPtr]::Zero)
`

export interface DictateResult {
  ok: boolean
  error?: string
}

let inFlight = false

/** Fire Win+H so Windows voice typing starts on the focused prompt box. */
export function startVoiceTyping(): Promise<DictateResult> {
  if (process.platform !== 'win32') {
    return Promise.resolve({ ok: false, error: 'Voice typing is Windows-only.' })
  }
  if (inFlight) return Promise.resolve({ ok: true })
  inFlight = true
  return new Promise((resolve) => {
    let settled = false
    const done = (result: DictateResult): void => {
      if (settled) return
      settled = true
      inFlight = false
      resolve(result)
    }
    try {
      const proc = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SEND_WIN_H_PS],
        { windowsHide: true, stdio: 'ignore' }
      )
      const timer = setTimeout(() => {
        log('[dictation] powershell timed out — killing')
        try { proc.kill() } catch { /* ignore */ }
        done({ ok: false, error: 'Voice typing timed out starting.' })
      }, 5000)
      proc.on('error', (err) => {
        clearTimeout(timer)
        log(`[dictation] spawn failed: ${String(err)}`)
        done({ ok: false, error: 'Could not start Windows voice typing.' })
      })
      proc.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) {
          log('[dictation] Win+H sent — Windows voice typing should be listening')
          done({ ok: true })
        } else {
          log(`[dictation] powershell exited ${code}`)
          done({ ok: false, error: 'Windows voice typing failed to start.' })
        }
      })
    } catch (err) {
      log(`[dictation] unexpected failure: ${String(err)}`)
      done({ ok: false, error: 'Voice typing failed to start.' })
    }
  })
}
