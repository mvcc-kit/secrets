// Regras do projeto que valem para todo arquivo: camadas, entradas públicas,
// documentação gerada e nada privado no repositório.
import { describe, expect, it } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import pkg from '../package.json'
import { codeBlocks, llmsFromSkill } from '../scripts/docs'
import { parseWords, scanText } from '../scripts/leak.logic'
import { privateWords, scanTrackedFiles } from '../scripts/leak-check'

const ROOT = path.join(import.meta.dir, '..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const importsOf = (source: string) => [...source.matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm), ...source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!)

describe('camadas', () => {
  it('o núcleo e as peças em memória rodam em qualquer lugar: sem node:, bun: nem SDK', () => {
    const files = [
      ...readdirSync(path.join(ROOT, 'src/core')).map((f) => `src/core/${f}`),
      'src/index.ts',
      'src/providers/memory.ts',
      'src/registries/memory.ts',
    ]
    for (const file of files) {
      const outside = importsOf(read(file)).filter((spec) => !spec.startsWith('.'))
      expect({ file, outside }).toEqual({ file, outside: [] })
    }
  })

  it('nenhum arquivo do núcleo escreve no console (valores nunca chegam a um log)', () => {
    for (const file of readdirSync(path.join(ROOT, 'src/core'))) expect({ file, log: /^\s*(await\s+)?console\.\w+\(/m.test(read(`src/core/${file}`)) }).toEqual({ file, log: false })
  })
})

describe('nome e instalação', () => {
  it('nome com escopo (sem escopo, o npm tem outro pacote) e sem instalação automática', () => {
    expect(pkg.name.startsWith('@mvcc-kit/')).toBe(true)
    expect(read('bunfig.toml')).toMatch(/\[install\][^[]*auto\s*=\s*"disable"/)
  })
})

describe('entradas públicas', () => {
  it('toda entrada de exports existe e importa', async () => {
    for (const [entry, file] of Object.entries(pkg.exports)) {
      expect({ entry, exists: Bun.file(path.join(ROOT, file)).size > 0 }).toEqual({ entry, exists: true })
      await import(path.join(ROOT, file))
    }
  })
})

describe('documentação', () => {
  it('llms.txt está em dia com SKILL.md', () => {
    expect(read('llms.txt')).toBe(llmsFromSkill(read('SKILL.md')))
  })

  it('os exemplos de SKILL.md e README.md passam nos tipos e rodam', () => {
    const dir = path.join(ROOT, '.cache', 'docs')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const blocks = ['SKILL.md', 'README.md'].flatMap((doc) => codeBlocks(read(doc)).map((block) => ({ ...block, doc })))
    expect(blocks.length).toBeGreaterThan(3)
    const files = blocks.map((block, index) => {
      const file = path.join(dir, `${block.doc.replace('.md', '')}-${block.line}-${index}.ts`)
      writeFileSync(file, `${block.code}\nexport {}\n`)
      return { ...block, file }
    })
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({ extends: '../../tsconfig.json', include: ['./*.ts'], exclude: [], compilerOptions: { noUnusedLocals: false } }),
    )
    const types = Bun.spawnSync(['bunx', 'tsc', '--noEmit', '-p', dir], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
    expect(types.stdout.toString() + types.stderr.toString()).toBe('')
    for (const block of files.filter((f) => f.run)) {
      const result = Bun.spawnSync(['bun', block.file], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' })
      expect({ where: `${block.doc}:${block.line}`, exit: result.exitCode, err: result.stderr.toString() }).toEqual({
        where: `${block.doc}:${block.line}`,
        exit: 0,
        err: '',
      })
    }
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('leak-check', () => {
  it('acha caminho, token, banco real, e-mail e palavra privada; deixa os exemplos', () => {
    const home = ['', 'Users', 'fulano', 'projeto'].join('/')
    const jwt = ['eyJhbGciOiJIUzI1', 'eyJzdWIiOiIxMjM0'].join('.')
    const turso = ['libsql://meu-banco-org', 'turso', 'io'].join('.')
    const email = ['fulano', 'empresa.com.br'].join('@')
    const text = `${home}\n${jwt}\n${turso}\n${email}\nAcme interno\nok@example.test noreply@anthropic.com 1+x@users.noreply.github.com`
    expect(scanText('x', text, ['acme']).map((f) => f.rule)).toEqual([
      'caminho de um computador',
      'token JWT',
      'banco real do Turso',
      'e-mail',
      'palavra privada',
    ])
    expect(parseWords('# comentário\nacme\n\n beta # outro\n')).toEqual(['acme', 'beta'])
  })

  it('os arquivos do repositório não têm nada privado', () => {
    expect(scanTrackedFiles(privateWords())).toEqual([])
  })
})
