import { app, dialog, shell, net } from 'electron'

const REPO = 'Shishir-ip/Gemini-Desktop-Companion'

/**
 * Check GitHub Releases for a newer version. When `interactive` the user
 * always gets a dialog (including "up to date" / failure states); otherwise
 * failures are silent.
 */
export async function checkForUpdates(interactive: boolean): Promise<void> {
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'gemini-desktop-companion-updater' }
    })
    if (!res.ok) throw new Error(`GitHub API responded with ${res.status}`)
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    const latest = (data.tag_name ?? '').replace(/^v/, '')
    const current = app.getVersion()

    if (isNewerVersion(latest, current)) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: `Gemini Desktop Companion ${latest} is available.`,
        detail: `You are running v${current}. Would you like to open the download page?`,
        buttons: ['Open Release Page', 'Later'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      if (response === 0 && data.html_url) await shell.openExternal(data.html_url)
    } else if (interactive) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Up to date',
        message: 'You are running the latest version.',
        detail: `Gemini Desktop Companion v${current}`,
        buttons: ['OK'],
        noLink: true
      })
    }
  } catch (err) {
    console.error('[updater] check failed:', err)
    if (interactive) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: 'Make sure you are connected to the internet and try again.',
        buttons: ['OK'],
        noLink: true
      })
    }
  }
}

function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v
      .split(/[.\-+_]/)
      .map((p) => Number.parseInt(p, 10))
      .map((n) => (Number.isNaN(n) ? 0 : n))
  const a = parse(candidate)
  const b = parse(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}
