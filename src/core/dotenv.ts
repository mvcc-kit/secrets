// Leitura de `.env`, pura. Sem `dotenv`: o formato aqui é pequeno e fechado, e
// qualquer coisa fora dele é erro com a linha, nunca um valor adivinhado.
//
//   NOME=valor            espaços nas pontas saem; `#` depois de espaço é comentário
//   export NOME=valor     o `export` é ignorado
//   NOME='literal'        nada é interpretado dentro de aspas simples
//   NOME="a\nb"           \n, \r, \t, \", \\ ; pode ocupar várias linhas
//
// Nome repetido é erro (no dotenv comum, o último vence em silêncio).

import { SecretsError } from './types'

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }

export function parseDotenv(text: string, label = '.env'): Record<string, string> {
  // Map e fromEntries: um nome `__proto__` vira propriedade própria, nunca o protótipo.
  const out = new Map<string, string>()
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1
    // Só o começo é aparado: espaço no fim de um valor entre aspas é parte dele.
    const line = lines[index]!.trimStart()
    if (!line.trim() || line.startsWith('#')) continue
    const body = line.replace(/^export\s+/, '')
    const eq = body.indexOf('=')
    const name = eq === -1 ? '' : body.slice(0, eq).trim()
    if (!NAME.test(name)) throw new SecretsError(`${label}, linha ${lineNumber}: esperado NOME=valor`)
    if (out.has(name)) throw new SecretsError(`${label}, linha ${lineNumber}: ${name} aparece duas vezes`)
    let rest = body.slice(eq + 1).trimStart()
    let value: string
    if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1)
      if (end === -1) throw new SecretsError(`${label}, linha ${lineNumber}: aspas simples sem fechamento em ${name}`)
      value = rest.slice(1, end)
      rest = rest.slice(end + 1)
    } else if (rest.startsWith('"')) {
      // Aspas duplas podem continuar nas linhas seguintes.
      let buffer = rest.slice(1)
      let decoded = ''
      let closed = false
      for (;;) {
        let i = 0
        for (; i < buffer.length; i++) {
          const char = buffer[i]!
          if (char === '\\' && i + 1 < buffer.length) {
            const next = buffer[i + 1]!
            decoded += ESCAPES[next] ?? `\\${next}`
            i++
          } else if (char === '"') {
            closed = true
            break
          } else decoded += char
        }
        if (closed) {
          rest = buffer.slice(i + 1)
          break
        }
        index++
        if (index >= lines.length) throw new SecretsError(`${label}, linha ${lineNumber}: aspas duplas sem fechamento em ${name}`)
        decoded += '\n'
        buffer = lines[index]!
      }
      value = decoded
    } else {
      const comment = rest.search(/\s#/)
      value = (comment === -1 ? rest : rest.slice(0, comment)).trim()
      rest = ''
    }
    if (rest.trim() && !rest.trim().startsWith('#')) throw new SecretsError(`${label}, linha ${lineNumber}: texto depois das aspas em ${name}`)
    out.set(name, value)
  }
  return Object.fromEntries(out)
}
