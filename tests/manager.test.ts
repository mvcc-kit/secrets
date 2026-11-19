import { afterEach, describe, expect, it } from 'bun:test'
import {
  createSecretsManager,
  FINGERPRINT_KEY_NAME,
  memoryProvider,
  memoryRegistry,
  type Provider,
  type SecretSpec,
  type SecretsRegistry,
  type StandardSchemaV1,
} from '../src'
import { envObject } from '../src/sources/env-file'
import { cleanup, fakeSecret, fastHasher, KEY, OTHER_KEY } from './helpers'

afterEach(cleanup)

const SPECS: Record<string, SecretSpec> = {
  DATABASE_URL: { check: (value) => (/^(libsql|https):\/\//.test(value) ? null : 'precisa ser libsql:// ou https://') },
  DATABASE_TOKEN: {},
  FORM_SECRET: { check: (value) => (value.length >= 32 ? null : '32+ caracteres'), locked: 'invalida os formulários abertos.' },
  OPTIONAL_HOOK: { required: false },
}

const VALUES = {
  DATABASE_URL: 'libsql://db.example.test',
  DATABASE_TOKEN: fakeSecret(1),
  FORM_SECRET: fakeSecret(2, 48),
}

/** Relógio falso: avança um dia a cada chamada a partir de uma data fixa. */
function clock(start = Date.UTC(2026, 0, 1)) {
  let day = 0
  return () => new Date(start + day++ * 86_400_000)
}

function setup(options: { local?: Record<string, string>; provider?: Provider; registry?: ReturnType<typeof memoryRegistry>; now?: () => Date; secrets?: Record<string, SecretSpec> } = {}) {
  const provider = options.provider ?? memoryProvider('memory:site')
  const registry = options.registry ?? memoryRegistry()
  const local = { ...VALUES, [FINGERPRINT_KEY_NAME]: KEY, ...options.local }
  const manager = createSecretsManager({
    environment: 'production',
    provider,
    local: envObject(local),
    registry,
    hasher: fastHasher,
    secrets: options.secrets ?? SPECS,
    actor: () => 'deploy@example.test',
    commit: 'abc123',
    now: options.now ?? clock(),
  })
  return { manager, provider, registry, local }
}

const statuses = (plan: { items: { name: string; status: string }[] }) => Object.fromEntries(plan.items.map((item) => [item.name, item.status]))

describe('manager', () => {
  it('primeiro envio: tudo novo; depois, tudo igual e nada a enviar', async () => {
    const { manager, provider, registry } = setup()
    const first = await manager.inspect()
    expect(statuses(first.plan)).toEqual({ DATABASE_TOKEN: 'new', DATABASE_URL: 'new', FORM_SECRET: 'new' })
    expect(first.plan.offer).toEqual(['DATABASE_TOKEN', 'DATABASE_URL', 'FORM_SECRET'])
    expect(first.plan.problems).toEqual([])
    await manager.push(first, first.plan.offer)
    expect(Object.fromEntries((provider as ReturnType<typeof memoryProvider>).stored)).toEqual(VALUES)
    const saved = registry.current()!
    expect(saved.lastVersion?.number).toBe(1)
    expect(saved.secrets.DATABASE_TOKEN).toMatchObject({ changedBy: 'deploy@example.test', commit: 'abc123', changes: 1 })
    expect(saved.history[0]!.sent).toEqual({ DATABASE_TOKEN: 'new', DATABASE_URL: 'new', FORM_SECRET: 'new' })
    const second = await setup({ provider, registry }).manager.inspect()
    expect(statuses(second.plan)).toEqual({ DATABASE_TOKEN: 'same', DATABASE_URL: 'same', FORM_SECRET: 'same' })
    expect(second.plan.offer).toEqual([])
  })

  it('nenhum valor aparece no plano, no contexto ou no registro', async () => {
    const { manager, registry } = setup()
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    const after = await setup({ registry }).manager.inspect()
    const everything = JSON.stringify([context, after, registry.current()])
    for (const value of [...Object.values(VALUES), KEY]) expect(everything).not.toContain(value)
    expect(everything).not.toContain('fake_')
  })

  it('valor local mudou: só ele vai; segredo só no provedor fica como está', async () => {
    const { manager, provider, registry } = setup()
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    const { manager: next } = setup({ provider, registry, local: { DATABASE_TOKEN: fakeSecret(9), DATABASE_URL: '' } })
    const plan = (await next.inspect()).plan
    expect(statuses(plan)).toEqual({ DATABASE_TOKEN: 'changed', DATABASE_URL: 'remote-only', FORM_SECRET: 'same' })
    expect(plan.offer).toEqual(['DATABASE_TOKEN'])
    expect(plan.warnings).toEqual([])
  })

  it('troca feita fora (painel): avisa, nada é conferível e tudo é oferecido de novo', async () => {
    const provider = memoryProvider('memory:site')
    const { manager, registry } = setup({ provider })
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    provider.changeOutside('DATABASE_TOKEN', fakeSecret(77), 'painel@example.test')
    const next = setup({ provider, registry }).manager
    const after = await next.inspect()
    expect(after.plan.warnings.join()).toContain('FORA desta ferramenta')
    expect(after.plan.warnings.join()).toContain('painel@example.test')
    expect(statuses(after.plan)).toEqual({ DATABASE_TOKEN: 'unverified', DATABASE_URL: 'unverified', FORM_SECRET: 'unverified' })
    expect(after.distrust).toBe(true)
    await next.push(after, ['DATABASE_TOKEN'])
    // O envio reconhece a troca: as impressões antigas deixaram de valer.
    expect(registry.current()!.secrets.DATABASE_URL!.fingerprint).toBeNull()
    expect(registry.current()!.history.at(-1)!.outsideChanges).toEqual([2])
  })

  it('chave de impressão trocada: avisa e nada é conferível', async () => {
    const { manager, provider, registry } = setup()
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    const after = await setup({ provider, registry, local: { [FINGERPRINT_KEY_NAME]: OTHER_KEY } }).manager.inspect()
    expect(after.plan.warnings.join()).toContain('não é a mesma do registro')
    expect(after.plan.offer).toEqual(['DATABASE_TOKEN', 'DATABASE_URL', 'FORM_SECRET'])
  })

  it('sem chave de impressão, obrigatório faltando ou valor recusado: problema, e o envio é recusado', async () => {
    const noKey = setup({ local: { [FINGERPRINT_KEY_NAME]: 'curta' } })
    const context = await noKey.manager.inspect()
    expect(context.plan.problems.join()).toContain(`${FINGERPRINT_KEY_NAME} ausente ou inválida`)
    await expect(noKey.manager.push(context, ['DATABASE_URL'])).rejects.toThrow('ausente')
    const missing = await setup({ local: { DATABASE_TOKEN: '' } }).manager.inspect()
    expect(missing.plan.problems).toEqual(['DATABASE_TOKEN: obrigatório, ausente no provedor e no arquivo local.'])
    const invalid = await setup({ local: { DATABASE_URL: 'http://inseguro', FORM_SECRET: 'curto' } }).manager.inspect()
    expect(invalid.plan.problems).toEqual([
      'DATABASE_URL: valor local recusado (precisa ser libsql:// ou https://).',
      'FORM_SECRET: valor local recusado (32+ caracteres).',
    ])
  })

  it('aceita Standard Schema (valibot, zod...) como validação', async () => {
    const schema: StandardSchemaV1 = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: async (value) => (String(value).startsWith('tok_') ? { value } : { issues: [{ message: 'precisa começar com tok_' }] }),
      },
    }
    const plan = (await setup({ secrets: { ...SPECS, DATABASE_TOKEN: { check: schema } } }).manager.inspect()).plan
    expect(plan.problems).toEqual(['DATABASE_TOKEN: valor local recusado (precisa começar com tok_).'])
  })

  it('nome não declarado: no local é ignorado, no provedor é sobra', async () => {
    const provider = memoryProvider('memory:site', { LEGACY: 'x' })
    const plan = (await setup({ provider, local: { NOT_DECLARED: fakeSecret(3) } }).manager.inspect()).plan
    expect(statuses(plan).LEGACY).toBe('extra')
    expect(plan.offer).not.toContain('NOT_DECLARED')
    expect(plan.warnings.join()).toContain('NOT_DECLARED: está no arquivo local, mas não foi declarado')
    expect(plan.warnings.join()).toContain('LEGACY: está no provedor, mas não foi declarado')
  })

  it('segredo travado: mudou bloqueia; destravado vai', async () => {
    const { manager, provider, registry } = setup()
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    const changed = { FORM_SECRET: fakeSecret(55, 48) }
    const blocked = await setup({ provider, registry, local: changed }).manager.inspect()
    expect(blocked.plan.problems.join()).toContain('FORM_SECRET está travado')
    expect(blocked.plan.problems.join()).toContain('invalida os formulários abertos.')
    const unlocked = await setup({ provider, registry, local: changed }).manager.inspect({ unlock: ['FORM_SECRET'] })
    expect(unlocked.plan.offer).toEqual(['FORM_SECRET'])
    const wrong = await setup({ provider, registry }).manager.inspect({ unlock: ['DATABASE_URL'] })
    expect(wrong.plan.problems).toEqual(['destravar DATABASE_URL: não é um segredo travado.'])
  })

  it('envio recusa nome fora do plano, repetido, e contexto já usado', async () => {
    const { manager } = setup()
    const context = await manager.inspect()
    await expect(manager.push(context, ['NOPE'])).rejects.toThrow('não pode ser enviado agora')
    await expect(manager.push(context, ['DATABASE_URL', 'DATABASE_URL'])).rejects.toThrow('repetido')
    await expect(manager.push(context, [])).rejects.toThrow('nenhum segredo')
    await manager.push(context, ['DATABASE_URL'])
    await expect(manager.push(context, ['DATABASE_TOKEN'])).rejects.toThrow('contexto desconhecido')
  })

  it('registro de outro ambiente ou alvo, ou adulterado, é erro', async () => {
    const { manager, registry, provider } = setup()
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    const stored = registry.current()!
    const other = memoryRegistry({ ...stored, environment: 'preview' })
    await expect(setup({ registry: other }).manager.inspect()).rejects.toThrow('de outro ambiente ou alvo')
    const broken = memoryRegistry({ ...stored, secrets: { X: { fingerprint: 1 } } } as unknown as SecretsRegistry)
    await expect(setup({ registry: broken }).manager.inspect()).rejects.toThrow('inválido')
    // Impressão trocada à mão por lixo vale como "mudou", nunca como erro.
    const forged = memoryRegistry({ ...stored, secrets: { ...stored.secrets, DATABASE_TOKEN: { ...stored.secrets.DATABASE_TOKEN!, fingerprint: 'lixo' } } })
    expect(statuses((await setup({ registry: forged, provider }).manager.inspect()).plan).DATABASE_TOKEN).toBe('changed')
  })

  it('alvo recriado, provedor sem versões e aviso de rotação', async () => {
    const { manager, registry } = setup()
    const context = await manager.inspect()
    await manager.push(context, context.plan.offer)
    // Worker recriado: a numeração recomeçou (nenhuma versão no provedor novo).
    const recreated = await setup({ registry, provider: memoryProvider('memory:site', VALUES) }).manager.inspect()
    expect(recreated.plan.warnings.join()).toContain('alvo recriado')
    const { listVersions: _, ...noVersions } = memoryProvider('memory:site')
    const blind = await setup({ provider: noVersions }).manager.inspect()
    expect(blind.plan.warnings.join()).toContain('não informa versões')
    const provider = memoryProvider('memory:site')
    const old = setup({ provider, now: () => new Date(Date.UTC(2026, 0, 1)) })
    const first = await old.manager.inspect()
    await old.manager.push(first, first.plan.offer)
    const later = await setup({ provider, registry: old.registry, now: () => new Date(Date.UTC(2026, 6, 20)) }).manager.inspect()
    expect(later.plan.warnings.join()).toContain('sem troca há 200 dias')
  })

  it('configuração inválida falha cedo', () => {
    expect(() => setup({ secrets: { 'bad-name': {} } })).toThrow('nome de segredo inválido')
    expect(() => setup({ secrets: { [FINGERPRINT_KEY_NAME]: {} } })).toThrow('nunca é um segredo')
  })
})
