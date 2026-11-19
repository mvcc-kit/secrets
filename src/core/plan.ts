// O que mudou, o que falta e o que pode ser enviado. Puro: recebe o que as peças
// leram e devolve o plano. Nenhum valor entra aqui, só nomes e comparações.
import { FINGERPRINT_KEY_NAME } from './fingerprint'
import type { ProviderVersion, SecretsRegistry, SecretStatus, VersionRef } from './types'

/** Segredo sem troca há mais tempo que isso recebe aviso de rotação. */
export const ROTATION_WARNING_DAYS = 180
const DAY_MS = 86_400_000

export interface OutsideChanges {
  changes: ProviderVersion[]
  /** A versão registrada não existe mais (alvo recriado). */
  replaced: boolean
  /** O provedor não informa versões: troca de fora não é detectável. */
  unknown: boolean
}

/**
 * Versões que esta ferramenta não criou, depois da última registrada: podem ter
 * trocado segredos. A lista do provedor pode ser só a página mais recente: a versão
 * registrada sumir dela não é erro. Alvo recriado = a numeração recomeçou (nenhuma
 * versão chega ao número registrado) ou o número registrado tem outro ID.
 */
export function outsideChanges(versions: ProviderVersion[] | null, last: VersionRef | null): OutsideChanges {
  if (versions === null) return { changes: [], replaced: false, unknown: true }
  if (!last) return { changes: [], replaced: false, unknown: false }
  const same = versions.find((version) => version.number === last.number)
  if (!versions.length || Math.max(...versions.map((version) => version.number)) < last.number || (same && same.id !== last.id))
    return { changes: [], replaced: true, unknown: false }
  return {
    changes: versions.filter((version) => version.number > last.number && version.origin === 'outside').sort((a, b) => a.number - b.number),
    replaced: false,
    unknown: false,
  }
}

export interface PlanItem {
  name: string
  status: SecretStatus
  required: boolean
  /** Consequência da troca, para segredo travado. */
  locked: string | null
  unlocked: boolean
  changedAt: string | null
}

export interface SecretsPlan {
  environment: string
  target: string
  items: PlanItem[]
  /** Podem ser enviados agora. */
  offer: string[]
  /** Bloqueiam o envio. */
  problems: string[]
  warnings: string[]
}

export interface PlanInput {
  environment: string
  target: string
  /** Nome → obrigatório? Só nomes declarados são segredos. */
  declared: Record<string, { required: boolean; locked: string | null }>
  remote: Set<string>
  /** Valores locais já validados (só os nomes importam aqui). */
  local: Set<string>
  /** null = sem impressão conferível. */
  sameAsRegistry: Record<string, boolean | null>
  registry: SecretsRegistry
  outside: OutsideChanges
  keyMatches: boolean
  hasKey: boolean
  unlocked: Set<string>
  invalidLocal: { name: string; reason: string }[]
  ignoredLocal: string[]
  now: Date
}

export function buildPlan(input: PlanInput): SecretsPlan {
  const problems: string[] = []
  const warnings: string[] = []
  const distrust = !input.keyMatches || input.outside.replaced || input.outside.changes.length > 0

  if (!input.hasKey)
    problems.push(
      `${FINGERPRINT_KEY_NAME} ausente ou inválida (64 caracteres hexadecimais; fica só no arquivo local e nunca vai ao provedor). Gere uma com: bun -e "import { generateFingerprintKey } from 'secrets'; console.log(generateFingerprintKey())"`,
    )
  else if (!input.keyMatches)
    warnings.push(`${FINGERPRINT_KEY_NAME} não é a mesma do registro: nenhum valor pode ser conferido. Reenvie os segredos para registrar com a chave atual.`)
  if (input.outside.unknown) warnings.push('o provedor não informa versões: uma troca feita fora desta ferramenta não seria detectada.')
  if (input.outside.replaced) warnings.push('a versão registrada não existe mais no provedor (alvo recriado?): nenhum valor pode ser conferido. Reenvie os segredos.')
  for (const change of input.outside.changes)
    warnings.push(
      `versão ${change.number} criada FORA desta ferramenta em ${change.createdAt.slice(0, 16).replace('T', ' ')} por ${change.author || 'desconhecido'} (${change.source || 'origem desconhecida'}): os valores no provedor podem não ser os do registro.`,
    )
  for (const { name, reason } of input.invalidLocal) problems.push(`${name}: valor local recusado (${reason}).`)
  for (const name of input.ignoredLocal) warnings.push(`${name}: está no arquivo local, mas não foi declarado; ignorado, nunca enviado.`)

  const names = [...new Set([...Object.keys(input.declared), ...input.remote, ...input.local, ...Object.keys(input.registry.secrets)])].sort()
  const items: PlanItem[] = []
  const add = (name: string, status: SecretStatus) => {
    const spec = input.declared[name]
    items.push({
      name,
      status,
      required: spec?.required ?? false,
      locked: spec?.locked ?? null,
      unlocked: input.unlocked.has(name),
      changedAt: input.registry.secrets[name]?.changedAt ?? null,
    })
  }
  for (const name of names) {
    const spec = input.declared[name]
    const remote = input.remote.has(name)
    const local = input.local.has(name)
    const entry = input.registry.secrets[name]
    if (!spec) {
      if (remote) {
        add(name, 'extra')
        warnings.push(`${name}: está no provedor, mas não foi declarado (sobra). Remova pelo provedor se não for mais usado.`)
      }
      continue
    }
    if (!remote && !local) {
      // Valor local recusado já virou problema acima: não repete como "ausente".
      if (!spec.required || input.invalidLocal.some((invalid) => invalid.name === name)) continue
      add(name, 'missing')
      problems.push(`${name}: obrigatório, ausente no provedor e no arquivo local.`)
      continue
    }
    if (!remote) {
      add(name, 'new')
      continue
    }
    if (!local) {
      // Já está no provedor e não há valor local: fica como está. Só avisa se nem dá para conferir.
      add(name, 'remote-only')
      if (!entry?.fingerprint || distrust) warnings.push(`${name}: sem valor local e sem impressão conferível; não dá para saber se o provedor está certo.`)
      continue
    }
    const same = distrust ? null : input.sameAsRegistry[name]
    const status: SecretStatus = same === null || same === undefined ? 'unverified' : same ? 'same' : 'changed'
    add(name, status)
    if (status === 'same' && entry) {
      const days = Math.floor((input.now.getTime() - Date.parse(entry.changedAt)) / DAY_MS)
      if (days >= ROTATION_WARNING_DAYS) warnings.push(`${name}: sem troca há ${days} dias; considere rotacionar.`)
    }
  }

  const offer: string[] = []
  for (const item of items) {
    if (item.status !== 'changed' && item.status !== 'new' && item.status !== 'unverified') continue
    // Travado só bloqueia quando se SABE que mudou. Sem registro (primeiro envio,
    // troca de fora), a confirmação mostra a consequência.
    if (item.locked && !item.unlocked && item.status === 'changed') {
      problems.push(
        `${item.name} está travado e o valor local difere do registro. Trocar: ${item.locked} Para trocar mesmo assim, destrave ${item.name}; para manter, volte o valor antigo no arquivo local.`,
      )
      continue
    }
    offer.push(item.name)
  }
  for (const name of input.unlocked) if (!input.declared[name]?.locked) problems.push(`destravar ${name}: não é um segredo travado.`)

  return { environment: input.environment, target: input.target, items, offer, problems, warnings }
}

/**
 * Motivo para recusar um envio, ou null. O plano é refeito na hora do envio: o que
 * mudou desde a confirmação, ou nunca foi oferecido, não sai.
 */
export function pushRefusal(plan: SecretsPlan, names: string[]): string | null {
  if (plan.problems.length) return 'o plano tem problemas; nada foi enviado'
  if (!names.length) return 'nenhum segredo informado; nada foi enviado'
  if (new Set(names).size !== names.length) return 'segredo repetido no envio; nada foi enviado'
  const outside = names.filter((name) => !plan.offer.includes(name))
  return outside.length ? `${outside.join(', ')} não pode ser enviado agora; nada foi enviado` : null
}

export const STATUS_LABEL: Record<SecretStatus, string> = {
  same: 'igual',
  changed: 'mudou',
  new: 'novo',
  unverified: 'sem registro',
  'remote-only': 'só no provedor',
  missing: 'falta',
  extra: 'sobra',
}

const ANSI = { red: '\u001B[31m', green: '\u001B[32m', yellow: '\u001B[33m', dim: '\u001B[2m', reset: '\u001B[0m' }
const STATUS_COLOR: Record<SecretStatus, string> = {
  new: ANSI.green,
  changed: ANSI.yellow,
  unverified: ANSI.yellow,
  missing: ANSI.red,
  extra: ANSI.red,
  same: '',
  'remote-only': ANSI.dim,
}

/** Linhas da tabela do terminal. Nunca contém valores. */
export function planReport(plan: SecretsPlan, now: Date, color = false): string[] {
  const paint = (code: string, text: string) => (color && code ? `${code}${text}${ANSI.reset}` : text)
  const width = Math.max(4, ...plan.items.map((item) => item.name.length))
  const lines = plan.items.map((item) => {
    const age = item.changedAt ? `trocado há ${Math.floor((now.getTime() - Date.parse(item.changedAt)) / DAY_MS)} d` : ''
    const flags = [item.required ? '' : 'opcional', item.locked ? (item.unlocked ? 'DESTRAVADO' : 'travado') : '', age].filter(Boolean)
    const enviar = plan.offer.includes(item.name) ? '  → enviar' : ''
    return paint(STATUS_COLOR[item.status], `  ${item.name.padEnd(width)}  ${STATUS_LABEL[item.status].padEnd(15)}${flags.length ? `  (${flags.join(', ')})` : ''}${enviar}`)
  })
  return [
    `Segredos de ${plan.environment} em ${plan.target} (${plan.items.length}; valores nunca exibidos):`,
    ...lines,
    ...plan.warnings.map((warning) => paint(ANSI.yellow, `Aviso: ${warning}`)),
    ...plan.problems.map((problem) => paint(ANSI.red, `Problema: ${problem}`)),
  ]
}
