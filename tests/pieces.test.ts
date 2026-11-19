import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSecretsManager, FINGERPRINT_KEY_NAME, fingerprinter, generateFingerprintKey, memoryProvider, memoryRegistry, parseDotenv, parseFingerprintKey, TargetMissingError } from '../src'
import { parseCliArgs, runCli } from '../src/cli'
import { cloudflareWorker, parseSecretNames, parseVersions, type Runner } from '../src/providers/cloudflare'
import { jsonRegistry } from '../src/registries/json-file'
import { envFile, envObject } from '../src/sources/env-file'
import { cleanup, fakeSecret, fastHasher, KEY, OTHER_KEY, tempDir } from './helpers'

afterEach(cleanup)

describe('parseDotenv', () => {
  it('lê os formatos aceitos', () => {
    const text = [
      '# comentário',
      'A=simples',
      'export B = com espaços   # comentário',
      "C='literal \\n #sem comentário'",
      'D="escape \\n \\t \\" \\\\ fim"',
      'E="várias',
      '  linhas"',
      'F=',
      'G=a#b',
      'H="  espaço nas pontas  "',
      '\uFEFFI=bom',
    ].join('\r\n')
    expect(parseDotenv(`\uFEFF${text}`)).toEqual({
      A: 'simples',
      B: 'com espaços',
      C: 'literal \\n #sem comentário',
      D: 'escape \n \t " \\ fim',
      E: 'várias\n  linhas',
      F: '',
      G: 'a#b',
      H: '  espaço nas pontas  ',
      I: 'bom',
    })
  })

  it('erro com a linha, nunca um valor adivinhado; __proto__ vira chave comum', () => {
    expect(() => parseDotenv('A=1\nA=2', 'x.env')).toThrow('x.env, linha 2: A aparece duas vezes')
    expect(() => parseDotenv('sem igual')).toThrow('linha 1: esperado NOME=valor')
    expect(() => parseDotenv("A='aberta")).toThrow('aspas simples sem fechamento')
    expect(() => parseDotenv('A="aberta\nB=2')).toThrow('aspas duplas sem fechamento')
    expect(() => parseDotenv('A="x" sobra')).toThrow('texto depois das aspas')
    expect(() => parseDotenv('1A=x')).toThrow('esperado NOME=valor')
    const parsed = parseDotenv('__proto__=x')
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.keys(parsed)).toEqual(['__proto__'])
  })

  it('ida e volta de 200 segredos falsos com caracteres difíceis', () => {
    const values = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`S_${i}`, fakeSecret(i)]))
    const escape = (value: string) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n')}"`
    const text = Object.entries(values)
      .map(([name, value]) => `${name}=${escape(value)}`)
      .join('\n')
    expect(parseDotenv(text)).toEqual(values)
  })
})

describe('impressões', () => {
  it('mesmo valor confere; ambiente, nome, valor ou chave diferentes não', async () => {
    const prod = fingerprinter('production', KEY, fastHasher)
    const print = await prod.make('TOKEN', 'abc')
    expect(print).toStartWith('$argon2id$')
    expect(print).not.toContain('abc')
    expect(await prod.matches('TOKEN', 'abc', print)).toBe(true)
    expect(await prod.matches('TOKEN', 'abd', print)).toBe(false)
    expect(await prod.matches('OTHER', 'abc', print)).toBe(false)
    expect(await fingerprinter('preview', KEY, fastHasher).matches('TOKEN', 'abc', print)).toBe(false)
    expect(await fingerprinter('production', OTHER_KEY, fastHasher).matches('TOKEN', 'abc', print)).toBe(false)
    // Sal aleatório: duas impressões do mesmo valor nunca são iguais.
    expect(await prod.make('TOKEN', 'abc')).not.toBe(print)
  })

  it('chave: 64 hexadecimais; gera uma nova', () => {
    expect(parseFingerprintKey(` ${'A'.repeat(64)} `)).toBe('a'.repeat(64))
    expect(parseFingerprintKey('a'.repeat(63))).toBeNull()
    expect(parseFingerprintKey(undefined)).toBeNull()
    const key = generateFingerprintKey()
    expect(parseFingerprintKey(key)).toBe(key)
    expect(generateFingerprintKey()).not.toBe(key)
  })
})

describe('envFile e jsonRegistry', () => {
  it('só lê arquivo comum com permissão 600', async () => {
    const dir = tempDir()
    const path = join(dir, '.env.production')
    writeFileSync(path, 'A=1\n')
    chmodSync(path, 0o644)
    await expect(envFile(path).read()).rejects.toThrow('chmod 600')
    chmodSync(path, 0o600)
    expect(await envFile(path).read()).toEqual({ A: '1' })
    symlinkSync(path, join(dir, 'link.env'))
    await expect(envFile(join(dir, 'link.env')).read()).rejects.toThrow('sem link simbólico')
    await expect(envFile(join(dir, 'nao-existe')).read()).rejects.toThrow('não existe')
    expect(await envFile(join(dir, 'nao-existe'), { optional: true }).read()).toEqual({})
    expect(await envObject({ A: '1', B: undefined }).read()).toEqual({ A: '1' })
  })

  it('registro em JSON: ausente é null, grava inteiro e lixo é erro', async () => {
    const path = join(tempDir(), 'secrets', 'production.json')
    const registry = jsonRegistry(path)
    expect(await registry.read()).toBeNull()
    const manager = createSecretsManager({
      environment: 'production',
      provider: memoryProvider('memory:x'),
      local: envObject({ A: 'valor-a', [FINGERPRINT_KEY_NAME]: KEY }),
      registry,
      hasher: fastHasher,
      secrets: { A: {} },
    })
    const context = await manager.inspect()
    await manager.push(context, ['A'])
    const text = await Bun.file(path).text()
    expect(JSON.parse(text)).toMatchObject({ format: 1, environment: 'production', target: 'memory:x' })
    expect(text).not.toContain('valor-a')
    writeFileSync(path, '{ lixo')
    await expect(registry.read()).rejects.toThrow('não é JSON')
  })
})

describe('cloudflareWorker (wrangler falso)', () => {
  const VERSIONS = [
    { id: '11111111-1111-4111-8111-111111111111', number: 1, metadata: { created_on: '2026-01-01T00:00:00Z', author_email: 'a@example.test', source: 'wrangler' }, annotations: { 'workers/tag': 'abc', 'workers/triggered_by': 'upload' } },
    { id: '22222222-2222-4222-8222-222222222222', number: 2, metadata: { created_on: '2026-01-02T00:00:00Z', source: 'dash' }, annotations: { 'workers/triggered_by': 'secret' } },
    { id: '33333333-3333-4333-8333-333333333333', number: 3, metadata: { created_on: '2026-01-03T00:00:00Z' }, annotations: { 'workers/tag': 'def', 'workers/triggered_by': 'secret' } },
  ]

  function fakeWrangler(overrides: Partial<Record<string, { code: number; stdout: string; stderr?: string }>> = {}) {
    const calls: { args: string[]; stdin?: string }[] = []
    const run: Runner = async (args, stdin) => {
      calls.push({ args, stdin })
      const key = args.slice(0, args.indexOf('--name') === -1 ? args.length : args.indexOf('--name')).filter((a) => !a.startsWith('--') || a === '--json').slice(0, 3).join(' ')
      const found = Object.entries(overrides).find(([prefix]) => key.startsWith(prefix))?.[1]
      if (found) return { code: found.code, stdout: found.stdout, stderr: found.stderr ?? '' }
      if (key.startsWith('secret list')) return { code: 0, stdout: '⛅️ wrangler\n[{"name":"A","type":"secret_text"}]', stderr: '' }
      if (key.startsWith('versions list')) return { code: 0, stdout: JSON.stringify(VERSIONS), stderr: '' }
      if (key.startsWith('versions secret bulk')) return { code: 0, stdout: `Created version ${VERSIONS[2]!.id} with 1 secret`, stderr: '' }
      return { code: 1, stdout: '', stderr: 'desconhecido' }
    }
    return { run, calls }
  }

  it('lê nomes e versões, e classifica a origem pela marca', async () => {
    const { run, calls } = fakeWrangler()
    const provider = cloudflareWorker({ worker: 'site', env: 'production', run })
    expect(provider.target).toBe('cloudflare:site')
    expect(await provider.listNames()).toEqual(['A'])
    const versions = await provider.listVersions!()
    expect(versions.map((v) => v.origin)).toEqual(['tool', 'outside', 'outside'])
    expect(calls[0]!.args).toEqual(['secret', 'list', '--format', 'json', '--name', 'site', '--env', 'production'])
  })

  it('os valores vão pela entrada do processo, nunca pela linha de comando', async () => {
    const { run, calls } = fakeWrangler()
    const value = fakeSecret(5)
    const version = await cloudflareWorker({ worker: 'site', run }).push({ A: value }, { tag: 'abc123', message: 'secrets: A (abc123)' })
    expect(version).toEqual({ id: VERSIONS[2]!.id, number: 3, createdAt: '2026-01-03T00:00:00Z' })
    const bulk = calls.find((call) => call.args[1] === 'secret')!
    expect(bulk.args).toEqual(['versions', 'secret', 'bulk', '--message', 'secrets: A (abc123)', '--tag', 'abc123', '--name', 'site'])
    expect(JSON.parse(bulk.stdin!)).toEqual({ A: value })
    expect(calls.flatMap((call) => call.args).join(' ')).not.toContain(value)
  })

  it('Worker ausente, falha e saída estranha viram erros claros, sem valores', async () => {
    const missing = cloudflareWorker({ worker: 'site', run: fakeWrangler({ 'secret list': { code: 1, stdout: '', stderr: 'Worker "site" not found [code: 10007]' } }).run })
    await expect(missing.listNames()).rejects.toBeInstanceOf(TargetMissingError)
    const auth = cloudflareWorker({ worker: 'site', run: fakeWrangler({ 'secret list': { code: 1, stdout: '', stderr: 'Authentication error' } }).run })
    await expect(auth.listNames()).rejects.toThrow('confira o login')
    const odd = cloudflareWorker({ worker: 'site', run: fakeWrangler({ 'secret list': { code: 0, stdout: 'nada' } }).run })
    await expect(odd.listNames()).rejects.toThrow('formato inesperado')
    const silent = cloudflareWorker({ worker: 'site', run: fakeWrangler({ 'versions secret bulk': { code: 0, stdout: 'ok' } }).run })
    await expect(silent.push({ A: 'segredo-x' }, { tag: 't', message: 'm' })).rejects.toThrow('não disse qual versão')
    const failed = cloudflareWorker({ worker: 'site', run: fakeWrangler({ 'versions secret bulk': { code: 1, stdout: '', stderr: 'erro segredo-x' } }).run })
    const error = await failed.push({ A: 'segredo-x' }, { tag: 't', message: 'm' }).catch((e: Error) => e)
    expect(String(error)).toContain('o envio dos segredos falhou')
    expect(String(error)).not.toContain('segredo-x')
  })

  it('parsers aceitam aviso antes do JSON e recusam formato errado', () => {
    expect(parseSecretNames('aviso\n[{"name":"X"}]')).toEqual(['X'])
    expect(parseSecretNames('[{"nome":"X"}]')).toBeNull()
    expect(parseVersions('{"x":1}')).toBeNull()
    expect(parseVersions('[{"id":"a"}]')).toBeNull()
  })
})

describe('cli', () => {
  const manager = () => {
    const provider = memoryProvider('memory:x')
    return {
      provider,
      manager: createSecretsManager({
        environment: 'production',
        provider,
        local: envObject({ A: 'a1', B: 'b1', [FINGERPRINT_KEY_NAME]: KEY }),
        registry: memoryRegistry(),
        hasher: fastHasher,
        secrets: { A: {}, B: {} },
      }),
    }
  }

  it('argumentos', () => {
    expect(parseCliArgs(['push', '--names=A,B', '--unlock=A', '--yes'])).toEqual({ command: 'push', names: ['A', 'B'], unlock: ['A'], yes: true })
    expect(() => parseCliArgs(['deploy'])).toThrow('uso:')
    expect(() => parseCliArgs(['check', '--yes'])).toThrow('argumento inválido')
    expect(() => parseCliArgs(['push', '--names=a-b'])).toThrow('argumento inválido')
  })

  it('check não envia; push pergunta, e só envia com sim', async () => {
    const { provider, manager: m } = manager()
    const log: string[] = []
    expect(await runCli(m, ['check'], { log: (line) => log.push(line), color: false })).toBe(0)
    expect(provider.stored.size).toBe(0)
    expect(log.join('\n')).toMatch(/A\s+novo\s+→ enviar/)
    expect(await runCli(m, ['push'], { log: () => {}, confirm: async () => false })).toBe(1)
    expect(provider.stored.size).toBe(0)
    let asked = ''
    expect(await runCli(m, ['push'], { log: () => {}, confirm: async (q) => ((asked = q), true) })).toBe(0)
    expect(asked).toBe('Enviar A, B para memory:x?')
    expect([...provider.stored.keys()]).toEqual(['A', 'B'])
    expect(await runCli(m, ['push', '--yes'], { log: (line) => log.push(line) })).toBe(0)
    expect(log.at(-1)).toBe('Nada a enviar.')
  })
})
