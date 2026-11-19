// Regras do leak-check, sem Git nem disco: recebem texto e devolvem achados.
// O repositório é público, inclusive o histórico (RELEASING.md, regra 8).

export interface Finding {
  where: string
  rule: string
  excerpt: string
}

/** Padrões que nunca podem ir para um repositório público. */
export const RULES: readonly { rule: string; pattern: RegExp }[] = [
  { rule: 'caminho de um computador', pattern: /(?:\/(?:Users|home)\/[A-Za-z0-9._-]+|[A-Za-z]:\\(?:Users|Documents and Settings)\\)/g },
  { rule: 'chave privada', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { rule: 'token JWT', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { rule: 'token do GitHub', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { rule: 'chave de API', pattern: /\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[abprs]-[A-Za-z0-9-]{10,})/g },
  { rule: 'banco real do Turso', pattern: /\b[a-z0-9-]+\.(?:[a-z0-9-]+\.)?turso\.io\b/g },
  { rule: 'Bearer com valor', pattern: /\bBearer [A-Za-z0-9._~+/-]{24,}/g },
  { rule: 'e-mail', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g },
]

/** E-mails públicos de propósito: domínios reservados para exemplo e os noreply. */
const ALLOWED_EMAIL = /(?:@(?:[A-Za-z0-9-]+\.)*example\.(?:test|com|org|net)$|@users\.noreply\.github\.com$|^noreply@anthropic\.com$)/i

function allowed(rule: string, match: string): boolean {
  return rule === 'e-mail' && ALLOWED_EMAIL.test(match)
}

/** Achados num texto. `words` são palavras privadas (sem diferenciar maiúsculas). */
export function scanText(where: string, text: string, words: readonly string[] = []): Finding[] {
  const findings: Finding[] = []
  for (const { rule, pattern } of RULES) {
    for (const match of text.matchAll(pattern)) {
      if (allowed(rule, match[0])) continue
      findings.push({ where, rule, excerpt: excerpt(text, match.index ?? 0, match[0].length) })
    }
  }
  const lower = text.toLowerCase()
  for (const word of words) {
    const needle = word.trim().toLowerCase()
    if (!needle) continue
    let index = lower.indexOf(needle)
    while (index !== -1) {
      findings.push({ where, rule: 'palavra privada', excerpt: excerpt(text, index, needle.length) })
      index = lower.indexOf(needle, index + needle.length)
    }
  }
  return findings
}

/** Trecho em volta do achado, numa linha, para achar sem mostrar demais. */
function excerpt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 20)
  return text
    .slice(start, index + length + 20)
    .replace(/\s+/g, ' ')
    .trim()
}

/** Palavras do arquivo `.private-words` (uma por linha; `#` é comentário). */
export function parseWords(file: string): string[] {
  return file
    .split('\n')
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean)
}
