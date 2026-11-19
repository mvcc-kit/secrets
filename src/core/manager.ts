// Junta as peças: lê o local, o provedor e o registro, monta o plano e envia.
// Não conhece Cloudflare, AWS, arquivo nem Bun: só os contratos de types.ts.
import { FINGERPRINT_KEY_NAME, fingerprinter, parseFingerprintKey } from './fingerprint'
import { buildPlan, outsideChanges, pushRefusal, type SecretsPlan } from './plan'
import { emptyRegistry, parseRegistry, recordPush } from './registry'
import { SecretsError, type Hasher, type LocalSource, type Provider, type RegistryStore, type SecretSpec, type SecretsRegistry, type VersionRef } from './types'

const NAME = /^[A-Z][A-Z0-9_]*$/
const ENVIRONMENT = /^[a-z0-9][a-z0-9_-]*$/

export interface SecretsConfig {
  /** Nome do ambiente (`production`, `preview`...). Entra na impressão. */
  environment: string
  provider: Provider
  local: LocalSource
  registry: RegistryStore
  hasher: Hasher
  /** Os segredos que existem. Nome fora daqui nunca é enviado. */
  secrets: Record<string, SecretSpec>
  /** Quem envia (gravado no registro). Padrão: `desconhecido`. */
  actor?: () => string | Promise<string>
  /** Commit do código: marca a versão criada e vai para o registro. */
  commit?: string
  now?: () => Date
}

export interface SecretsContext {
  readonly plan: SecretsPlan
  readonly registry: SecretsRegistry
  /** Impressões antigas deixam de valer no próximo envio. */
  readonly distrust: boolean
  readonly outsideNumbers: number[]
}

export interface SecretsManager {
  /** Só lê. Nunca escreve no provedor nem no registro. */
  inspect(options?: { unlock?: readonly string[] }): Promise<SecretsContext>
  /** Envia os nomes escolhidos (precisam estar em `plan.offer`) e grava o registro. */
  push(context: SecretsContext, names: readonly string[]): Promise<VersionRef>
}

async function checkValue(spec: SecretSpec, value: string): Promise<string | null> {
  const check = spec.check
  if (!check) return null
  if (typeof check === 'function') return check(value)
  const result = await check['~standard'].validate(value)
  return result.issues ? result.issues.map((issue) => issue.message).join('; ') || 'valor inválido' : null
}

export function createSecretsManager(config: SecretsConfig): SecretsManager {
  const { environment, provider, hasher } = config
  if (!ENVIRONMENT.test(environment)) throw new SecretsError(`ambiente inválido "${environment}": letras minúsculas, dígitos, - e _`)
  for (const name of Object.keys(config.secrets)) {
    if (!NAME.test(name)) throw new SecretsError(`nome de segredo inválido "${name}": use MAIÚSCULAS, dígitos e _`)
    if (name === FINGERPRINT_KEY_NAME) throw new SecretsError(`${FINGERPRINT_KEY_NAME} nunca é um segredo do provedor`)
  }
  const now = config.now ?? (() => new Date())
  const commit = config.commit ?? 'desconhecido'
  // Os valores ficam aqui, presos ao contexto: o objeto devolvido não os carrega,
  // e um console.log(contexto) por engano não vaza nada.
  const values = new WeakMap<SecretsContext, { local: Record<string, string>; key: string | null }>()

  async function inspect(options: { unlock?: readonly string[] } = {}): Promise<SecretsContext> {
    const file = await config.local.read()
    const key = parseFingerprintKey(file[FINGERPRINT_KEY_NAME])
    const local: Record<string, string> = {}
    const invalidLocal: { name: string; reason: string }[] = []
    const ignoredLocal: string[] = []
    for (const [name, value] of Object.entries(file)) {
      if (name === FINGERPRINT_KEY_NAME || !value.trim()) continue
      const spec = config.secrets[name]
      if (!spec) {
        ignoredLocal.push(name)
        continue
      }
      const reason = await checkValue(spec, value)
      if (reason) invalidLocal.push({ name, reason })
      else local[name] = value
    }

    const remote = new Set(await provider.listNames())
    const versions = provider.listVersions ? await provider.listVersions() : null
    const stored = await config.registry.read()
    const registry = stored === null ? emptyRegistry(environment, provider.target) : parseRegistry(stored, environment, provider.target, config.registry.label)
    const outside = outsideChanges(versions, registry.lastVersion)

    const prints = key ? fingerprinter(environment, key, hasher) : null
    const keyMatches = !registry.keyCheck || (prints ? await prints.keyMatches(registry.keyCheck) : false)
    const sameAsRegistry: Record<string, boolean | null> = {}
    for (const [name, value] of Object.entries(local)) {
      const fingerprint = registry.secrets[name]?.fingerprint
      // Uma conferência por vez: o argon2id usa bastante memória em cada uma.
      sameAsRegistry[name] = prints && keyMatches && fingerprint ? await prints.matches(name, value, fingerprint) : null
    }

    const declared = Object.fromEntries(
      Object.entries(config.secrets).map(([name, spec]) => [name, { required: spec.required ?? true, locked: spec.locked ?? null }]),
    )
    const plan = buildPlan({
      environment,
      target: provider.target,
      declared,
      remote,
      local: new Set(Object.keys(local)),
      sameAsRegistry,
      registry,
      outside,
      keyMatches,
      hasKey: key !== null,
      unlocked: new Set(options.unlock ?? []),
      invalidLocal,
      ignoredLocal,
      now: now(),
    })
    const context: SecretsContext = {
      plan,
      registry,
      distrust: !keyMatches || outside.replaced || outside.changes.length > 0,
      outsideNumbers: outside.changes.map((change) => change.number),
    }
    values.set(context, { local, key })
    return context
  }

  async function push(context: SecretsContext, names: readonly string[]): Promise<VersionRef> {
    const held = values.get(context)
    if (!held) throw new SecretsError('contexto desconhecido: use o que inspect() devolveu')
    if (!held.key) throw new SecretsError(`${FINGERPRINT_KEY_NAME} ausente; nada foi enviado`)
    const refusal = pushRefusal(context.plan, [...names])
    if (refusal) throw new SecretsError(refusal)
    const chosen = Object.fromEntries(names.map((name) => [name, held.local[name]!]))
    const version = await provider.push(chosen, { tag: commit, message: `secrets: ${names.join(', ')} (${commit})` })
    const prints = fingerprinter(environment, held.key, hasher)
    const fingerprints: Record<string, string> = {}
    for (const name of names) fingerprints[name] = await prints.make(name, chosen[name]!)
    const statuses = new Map(context.plan.items.map((item) => [item.name, item.status]))
    await config.registry.write(
      recordPush(context.registry, {
        sent: Object.fromEntries(names.map((name) => [name, statuses.get(name)!])),
        fingerprints,
        version,
        by: (await config.actor?.()) || 'desconhecido',
        commit,
        at: now().toISOString(),
        keyCheck: await prints.makeKeyCheck(),
        outsideChanges: context.outsideNumbers,
        distrust: context.distrust,
      }),
    )
    // O contexto vale para um envio só: o próximo precisa de um plano novo.
    values.delete(context)
    return version
  }

  return { inspect, push }
}
