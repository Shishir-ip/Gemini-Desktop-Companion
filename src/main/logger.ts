import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const LOG_MAX_BYTES = 256 * 1024

let logPath = ''

/** Initialize the rotating file log (userData/logs/main.log). */
export function initLogger(): void {
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    logPath = path.join(dir, 'main.log')
    try {
      if (statSync(logPath).size > LOG_MAX_BYTES) unlinkSync(logPath)
    } catch {
      /* first run */
    }
  } catch (err) {
    console.error('[logger] init failed:', err)
    logPath = ''
  }
  log(`— Gemini Desktop Companion v${app.getVersion()} ${app.isPackaged ? '(packaged)' : '(dev)'} —`)
}

/** Log to console and (once initialized) to the log file. */
export function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  if (!logPath) return
  try {
    appendFileSync(logPath, line + '\n')
  } catch {
    /* best effort */
  }
}

export function getLogPath(): string {
  return logPath
}
