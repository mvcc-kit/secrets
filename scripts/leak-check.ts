#!/usr/bin/env bun
// Confere que nada privado vai para o GitHub: arquivos versionados, o histórico
// inteiro e os autores dos commits. Uso: bun run leak-check
// Palavras privadas (nome de projeto, cliente, pessoa): uma por linha em
// `.private-words` (fora do Git) ou em SECRETS_PRIVATE_WORDS, separadas por vírgula.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseWords, scanText, type Finding } from './leak.logic'

const ROOT = path.join(import.meta.dir, '..')

function git(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

export function privateWords(): string[] {
  const file = path.join(ROOT, '.private-words')
  return [...(existsSync(file) ? parseWords(readFileSync(file, 'utf8')) : []), ...(process.env.SECRETS_PRIVATE_WORDS ?? '').split(',')].filter(
    (word) => word.trim(),
  )
}

/** Arquivos versionados, como estão no disco (o que o próximo commit leva). */
export function scanTrackedFiles(words: readonly string[]): Finding[] {
  const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean)
  return files.flatMap((file) => {
    if (file === 'bun.lock') return []
    const full = path.join(ROOT, file)
    if (!existsSync(full)) return []
    const bytes = readFileSync(full)
    if (bytes.includes(0)) return []
    return scanText(file, bytes.toString('utf8'), words)
  })
}

/** Todo o histórico: conteúdo de cada commit e quem o fez. */
export function scanHistory(words: readonly string[]): Finding[] {
  const hasCommits = Bun.spawnSync(['git', 'rev-parse', '--verify', 'HEAD'], { cwd: ROOT, stdout: 'ignore', stderr: 'ignore' }).exitCode === 0
  if (!hasCommits) return []
  const meta = git(['log', '--all', '--format=%H %an <%ae> %cn <%ce>%n%B'])
  const patches = git(['log', '--all', '-p', '--format=commit %H', '--', '.', ':(exclude)bun.lock'])
  return [...scanText('autores e mensagens dos commits', meta, words), ...scanText('histórico do Git', patches, words)]
}

if (import.meta.main) {
  const words = privateWords()
  const findings = [...scanTrackedFiles(words), ...scanHistory(words)]
  if (!words.length) console.warn('Aviso: sem palavras privadas (.private-words ou SECRETS_PRIVATE_WORDS); só os padrões gerais foram conferidos.')
  if (findings.length) {
    console.error(`Vazamento: ${findings.length} achado(s).`)
    for (const finding of findings.slice(0, 50)) console.error(`- ${finding.where}: ${finding.rule}: "${finding.excerpt}"`)
    process.exit(1)
  }
  console.log(`Nada privado encontrado (${words.length} palavras privadas conferidas).`)
}
