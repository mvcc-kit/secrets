// Dados falsos determinísticos e peças rápidas para os testes. Nada aqui depende do relógio.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bunArgon2 } from '../src/hashers/bun'

const cleanups: (() => void)[] = []
export function cleanup() {
  for (const fn of cleanups.splice(0)) fn()
}

export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'secrets-test-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** argon2id de verdade, mas barato: os testes conferem a lógica, não o custo. */
export const fastHasher = bunArgon2({ memoryCost: 1024, timeCost: 1 })

/** Gerador com semente (mulberry32): os mesmos valores a cada execução. */
export function seeded(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
/** Valores falsos com cara de segredo, e alguns com caracteres que quebram parser. */
export function fakeSecret(seed: number, length = 40): string {
  const next = seeded(seed)
  const body = Array.from({ length }, () => ALPHABET[Math.floor(next() * ALPHABET.length)]).join('')
  const tricky = ['', ' com espaço', '="igual"', '#não-é-comentário', "aspa'simples", 'linha1\nlinha2', 'ação ✓ 🎮']
  return `fake_${body}${tricky[seed % tricky.length]}`
}

export const KEY = 'a'.repeat(64)
export const OTHER_KEY = 'b'.repeat(64)
