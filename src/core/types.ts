// Contratos entre o núcleo e as peças trocáveis. O núcleo nunca imprime um valor
// de segredo, nunca o grava em disco e só o entrega ao `Provider.push`.

/** Onde os segredos ficam (Cloudflare Workers, AWS Secrets Manager, ...). */
export interface Provider {
  /** Nome para mensagens (ex.: `cloudflare:meu-worker`). Nunca leva valores. */
  readonly target: string
  /** Nomes dos segredos que já estão lá. O provedor nunca devolve valores. */
  listNames(): Promise<string[]>
  /**
   * Versões recentes, para descobrir troca feita fora desta ferramenta (painel,
   * outro comando). Sem esta função, a troca de fora não é detectada e o plano avisa.
   */
  listVersions?(): Promise<ProviderVersion[]>
  /** Envia os valores. Devolve a versão criada, para o registro. */
  push(values: Readonly<Record<string, string>>, meta: PushMeta): Promise<VersionRef>
}

export interface PushMeta {
  /** Marca da versão (o commit). Versão sem esta marca é tratada como troca de fora. */
  tag: string
  message: string
}

export interface VersionRef {
  id: string
  number: number
  createdAt: string
}

export interface ProviderVersion extends VersionRef {
  /** `tool`: criada por esta ferramenta ou pelo deploy marcado; `outside`: painel ou outro comando. */
  origin: 'tool' | 'outside'
  author: string
  source: string
}

/** De onde vêm os valores locais (um `.env`, um cofre de senhas, ...). */
export interface LocalSource {
  readonly label: string
  read(): Promise<Record<string, string>>
}

/** Onde fica o registro de impressões (versionado no Git, só com impressões). */
export interface RegistryStore {
  readonly label: string
  /** null quando ainda não existe. */
  read(): Promise<unknown | null>
  write(registry: SecretsRegistry): Promise<void>
}

/** Hash de senha lento e com sal (argon2id). Recebe só o HMAC, nunca o valor. */
export interface Hasher {
  readonly name: string
  hash(input: string): Promise<string>
  verify(input: string, hashed: string): Promise<boolean>
}

/** Standard Schema v1 (valibot, zod, arktype...), sem depender de nenhum deles. */
export interface StandardSchemaV1 {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    validate(value: unknown): StandardResult | Promise<StandardResult>
  }
}

type StandardResult = { readonly value: unknown; readonly issues?: undefined } | { readonly issues: ReadonlyArray<{ readonly message: string }> }

export interface SecretSpec {
  /** Sem ele no provedor e no local, o plano bloqueia. Padrão: true. */
  required?: boolean
  /** Validação do valor local: função (mensagem de erro ou null) ou um Standard Schema. */
  check?: ((value: string) => string | null) | StandardSchemaV1
  /** Troca com consequência: só muda com `unlock`. O texto diz qual é a consequência. */
  locked?: string
}

export interface SecretEntry {
  /** null: valor do provedor não conferível (troca de fora ou chave nova). */
  fingerprint: string | null
  createdAt: string
  changedAt: string
  changedBy: string
  commit: string
  version: VersionRef
  changes: number
}

export interface HistoryEvent {
  at: string
  by: string
  commit: string
  version: VersionRef
  /** Nome → situação antes do envio. */
  sent: Record<string, SecretStatus>
  /** Números das versões de fora reconhecidas neste envio. */
  outsideChanges: number[]
}

export interface SecretsRegistry {
  format: 1
  environment: string
  target: string
  /** Prova de que a chave de impressão é a mesma (impressão de um texto fixo). */
  keyCheck: string | null
  lastVersion: VersionRef | null
  secrets: Record<string, SecretEntry>
  history: HistoryEvent[]
}

export type SecretStatus =
  /** Local igual ao registrado. */
  | 'same'
  /** Local diferente do registrado. */
  | 'changed'
  /** Ainda não está no provedor. */
  | 'new'
  /** Está no provedor, mas não há impressão conferível. */
  | 'unverified'
  /** Está no provedor e não há valor local: fica como está. */
  | 'remote-only'
  /** Obrigatório, sem valor no provedor e no local. */
  | 'missing'
  /** No provedor, mas não declarado: sobra. */
  | 'extra'

export class SecretsError extends Error {
  constructor(message: string) {
    super(`secrets: ${message}`)
    this.name = 'SecretsError'
  }
}

/** O alvo ainda não existe no provedor (ex.: Worker nunca publicado). */
export class TargetMissingError extends SecretsError {
  override name = 'TargetMissingError'
}
