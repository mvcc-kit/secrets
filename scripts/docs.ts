#!/usr/bin/env bun
// Documentação com uma fonte só: SKILL.md gera llms.txt.
// Uso: bun run docs (tests/docs.test.ts falha se llms.txt estiver desatualizado).
import path from 'node:path'

const ROOT = path.join(import.meta.dir, '..')

/** Bloco que só passa pela checagem de tipos (precisa de servidor, token, etc.). */
export const TYPES_ONLY = '// exemplo: só tipos'

/** llms.txt = SKILL.md sem o frontmatter, com aviso de arquivo gerado. */
export function llmsFromSkill(skill: string): string {
  const body = skill.replace(/^---\n[\s\S]*?\n---\n+/, '')
  return `<!-- Gerado de SKILL.md por \`bun run docs\`. Não edite aqui. -->\n\n${body}`
}

/** Blocos ```ts de um markdown, com a linha onde começam. */
export function codeBlocks(md: string): { line: number; code: string; run: boolean }[] {
  return [...md.matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map((match) => ({
    line: md.slice(0, match.index).split('\n').length,
    code: match[1]!,
    run: !match[1]!.startsWith(TYPES_ONLY),
  }))
}

if (import.meta.main) {
  const skill = await Bun.file(path.join(ROOT, 'SKILL.md')).text()
  await Bun.write(path.join(ROOT, 'llms.txt'), llmsFromSkill(skill))
  console.log('llms.txt gerado de SKILL.md')
}
