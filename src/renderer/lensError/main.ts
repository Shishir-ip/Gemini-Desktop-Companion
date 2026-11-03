/**
 * Shell page for the Lens panel. Shows a loading state while the main
 * process uploads the crop; on success the window navigates away to the
 * results URL, on failure this page reveals the error card.
 */

const loading = document.getElementById('loading') as HTMLElement
const error = document.getElementById('error') as HTMLElement
const btnRetry = document.getElementById('btn-retry') as HTMLButtonElement
const btnExternal = document.getElementById('btn-external') as HTMLButtonElement

window.gdc.lens.onError(() => {
  loading.hidden = true
  error.hidden = false
})

btnRetry.addEventListener('click', () => {
  error.hidden = true
  loading.hidden = false
  void window.gdc.lens.retry().then((ok) => {
    if (!ok) {
      loading.hidden = true
      error.hidden = false
    }
  })
})

btnExternal.addEventListener('click', () => {
  void window.gdc.openExternal('https://lens.google.com/')
})
