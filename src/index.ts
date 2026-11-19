// Entrada pública do núcleo. Não importa Node, Bun nem SDK de provedor.
export { createSecretsManager } from './core/manager'
export type { SecretsConfig, SecretsContext, SecretsManager } from './core/manager'
export { buildPlan, outsideChanges, planReport, pushRefusal, ROTATION_WARNING_DAYS, STATUS_LABEL } from './core/plan'
export type { OutsideChanges, PlanInput, PlanItem, SecretsPlan } from './core/plan'
export { emptyRegistry, parseRegistry, recordPush } from './core/registry'
export type { PushRecord } from './core/registry'
export { FINGERPRINT_KEY_NAME, fingerprinter, generateFingerprintKey, parseFingerprintKey } from './core/fingerprint'
export type { Fingerprinter } from './core/fingerprint'
export { parseDotenv } from './core/dotenv'
export { memoryRegistry } from './registries/memory'
export { memoryProvider } from './providers/memory'
export type { MemoryProvider } from './providers/memory'
export {
  SecretsError,
  TargetMissingError,
  type Hasher,
  type HistoryEvent,
  type LocalSource,
  type Provider,
  type ProviderVersion,
  type PushMeta,
  type RegistryStore,
  type SecretEntry,
  type SecretSpec,
  type SecretsRegistry,
  type SecretStatus,
  type StandardSchemaV1,
  type VersionRef,
} from './core/types'
