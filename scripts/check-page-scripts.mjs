// Syntax-check the injected page scripts (temp tool).
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const src = readFileSync('src/main/gemini/session.ts', 'utf8')

function extract(name) {
  const start = src.indexOf('const ' + name)
  const bt = src.indexOf('`', start)
  let i = bt + 1
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2
      continue
    }
    if (src[i] === '`') return src.slice(bt + 1, i)
    i++
  }
  throw new Error('unterminated ' + name)
}

for (const n of ['PAGE_SUBMIT', 'PAGE_OBSERVER']) {
  new vm.Script(extract(n))
  console.log(n, 'OK')
}
