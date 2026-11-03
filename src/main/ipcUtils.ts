import { shell } from 'electron'

/** Open a URL in the user's default browser, only for http(s) schemes. */
export async function openExternalUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return
  await shell.openExternal(url)
}
