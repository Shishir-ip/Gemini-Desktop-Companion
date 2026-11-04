const { app, safeStorage } = require('electron')
app.setName('Gemini Desktop Companion')
app.setPath('userData', path.join(process.env.APPDATA, 'Gemini Desktop Companion'))
const https = require('node:https')
const path = require('node:path')
const fs = require('node:fs')
const Store = require('electron-store')

const LOG = (m) => fs.appendFileSync(process.env.GDC_DIAG_OUT, String(m) + '\n')

app.whenReady().then(async () => {
  try {
    const store = new Store({ cwd: path.join(process.env.APPDATA, 'Gemini Desktop Companion') })
    const enc = store.get('apiKeyEnc')
    if (!enc) { LOG('NO KEY STORED'); app.quit(); return }
    const key = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(enc, 'base64'))
      : Buffer.from(enc, 'base64').toString('utf8')
    const redact = (s) => s.replaceAll(key, '***KEY***')

    const post = (model, body) =>
      new Promise((resolve) => {
        const payload = JSON.stringify(body)
        const req = https.request(
          {
            host: 'generativelanguage.googleapis.com',
            path: '/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
            timeout: 45000
          },
          (res) => {
            let d = ''
            res.on('data', (c) => (d += c))
            res.on('end', () => resolve({ status: res.statusCode, body: redact(d).slice(0, 350) }))
          }
        )
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }) })
        req.on('error', (e) => resolve({ status: 0, body: String(e) }))
        req.write(payload)
        req.end()
      })

    const base = { contents: [{ role: 'user', parts: [{ text: 'Say OK' }] }] }
    LOG('A) plain, gemini-3.5-flash-lite:')
    LOG(JSON.stringify(await post('gemini-3.5-flash-lite', base)))
    LOG('B) thinkingBudget=0, gemini-3.5-flash-lite:')
    LOG(JSON.stringify(await post('gemini-3.5-flash-lite', { ...base, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } })))
    LOG('C) thinkingLevel=low, gemini-3.5-flash-lite:')
    LOG(JSON.stringify(await post('gemini-3.5-flash-lite', { ...base, generationConfig: { thinkingConfig: { thinkingLevel: 'low' } } })))
    LOG('D) plain, gemini-3.8-flash:')
    LOG(JSON.stringify(await post('gemini-3.8-flash', base)))
    LOG('E) thinkingBudget=0, gemini-3.8-flash:')
    LOG(JSON.stringify(await post('gemini-3.8-flash', { ...base, generationConfig: { thinkingConfig: { thinkingBudget: 0 } } })))
  } catch (e) {
    LOG('ERROR: ' + String(e))
  }
  app.quit()
})
