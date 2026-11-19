// Registro versionado de impressões (`secrets/<ambiente>.json` no Git). Só tem
// impressões, datas, autores e versões: nunca um valor.
import { SecretsError, type HistoryEvent, type SecretEntry, type SecretsRegistry, type SecretStatus, type VersionRef } from './types'

export function emptyRegistry(environment: string, target: string): SecretsRegistry {
  return { format: 1, environment, target, keyCheck: null, lastVersion: null, secrets: {}, history: [] }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function isVersion(value: unknown): value is VersionRef {
  return isObject(value) && isString(value.id) && isNumber(value.number) && isString(value.createdAt)
}

function isEntry(value: unknown): value is SecretEntry {
  return (
    isObject(value) &&
    (value.fingerprint === null || isString(value.fingerprint)) &&
    isString(value.createdAt) &&
    isString(value.changedAt) &&
    isString(value.changedBy) &&
    isString(value.commit) &&
    isVersion(value.version) &&
    isNumber(value.changes)
  )
}

function isEvent(value: unknown): value is HistoryEvent {
  return (
    isObject(value) &&
    isString(value.at) &&
    isString(value.by) &&
    isString(value.commit) &&
    isVersion(value.version) &&
    isObject(value.sent) &&
    Object.values(value.sent).every(isString) &&
    Array.isArray(value.outsideChanges) &&
    value.outsideChanges.every(isNumber)
  )
}

/**
 * Confere o registro lido. Registro de outro ambiente ou outro alvo é erro: apontar o
 * registro de produção para o preview nunca pode passar em silêncio.
 */
export function parseRegistry(data: unknown, environment: string, target: string, label: string): SecretsRegistry {
  const valid =
    isObject(data) &&
    data.format === 1 &&
    isString(data.environment) &&
    isString(data.target) &&
    (data.keyCheck === null || isString(data.keyCheck)) &&
    (data.lastVersion === null || isVersion(data.lastVersion)) &&
    isObject(data.secrets) &&
    Object.values(data.secrets).every(isEntry) &&
    Array.isArray(data.history) &&
    data.history.every(isEvent)
  if (!valid) throw new SecretsError(`${label} inválido; corrija pelo histórico do Git`)
  const registry = data as unknown as SecretsRegistry
  if (registry.environment !== environment || registry.target !== target)
    throw new SecretsError(`${label} é de outro ambiente ou alvo (${registry.environment}, ${registry.target})`)
  return registry
}

export interface PushRecord {
  sent: Record<string, SecretStatus>
  fingerprints: Record<string, string>
  version: VersionRef
  by: string
  commit: string
  at: string
  keyCheck: string
  outsideChanges: number[]
  /** Impressões antigas deixam de valer (troca de fora, chave nova ou alvo recriado). */
  distrust: boolean
}

/** Registro depois de um envio aceito pelo provedor. */
export function recordPush(registry: SecretsRegistry, push: PushRecord): SecretsRegistry {
  const secrets: Record<string, SecretEntry> = {}
  for (const [name, entry] of Object.entries(registry.secrets)) secrets[name] = push.distrust ? { ...entry, fingerprint: null } : entry
  for (const [name, fingerprint] of Object.entries(push.fingerprints)) {
    const previous = registry.secrets[name]
    secrets[name] = {
      fingerprint,
      createdAt: previous?.createdAt ?? push.at,
      changedAt: push.at,
      changedBy: push.by,
      commit: push.commit,
      version: push.version,
      changes: (previous?.changes ?? 0) + 1,
    }
  }
  return {
    ...registry,
    keyCheck: push.keyCheck,
    lastVersion: push.version,
    secrets: Object.fromEntries(Object.entries(secrets).sort(([a], [b]) => a.localeCompare(b))),
    history: [
      ...registry.history,
      { at: push.at, by: push.by, commit: push.commit, version: push.version, sent: push.sent, outsideChanges: push.outsideChanges },
    ],
  }
}
