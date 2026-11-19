// Cloudflare Workers pelo wrangler. Toda a conversa com a Cloudflare passa por
// `run`: se a CLI ou a API mudar, o ajuste fica neste arquivo.
//
// Envio: `wrangler versions secret bulk` cria uma versão do Worker SEM tráfego com
// os segredos novos; o deploy seguinte (`wrangler deploy --tag <commit>`) herda os
// segredos dela. Troca de fora: versão sem `workers/tag`, ou criada por
// `wrangler secret put`/painel (`workers/triggered_by: secret`).
import { SecretsError, TargetMissingError, type Provider, type ProviderVersion, type VersionRef } from '../core/types'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Roda o wrangler com estes argumentos (e o texto na entrada, se houver). */
export type Runner = (args: string[], stdin?: string) => Promise<RunResult>

export interface CloudflareWorkerOptions {
  /** Nome do Worker na Cloudflare (o `name` do wrangler.jsonc, ou o do ambiente). */
  worker: string
  /** Ambiente do wrangler.jsonc (`--env`), se o projeto usar. */
  env?: string
  /** Pasta do wrangler.jsonc. */
  cwd?: string
  /** Comando do wrangler. Padrão: `wrangler` no PATH. */
  wrangler?: string
  /** Troca a execução (testes, outra CLI). */
  run?: Runner
}

function bunRunner(cwd: string | undefined, command: string): Runner {
  return async (args, stdin) => {
    const child = Bun.spawn([command, ...args], { cwd, stdin: stdin === undefined ? 'ignore' : 'pipe', stdout: 'pipe', stderr: 'pipe' })
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin)
      await child.stdin.end()
    }
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    return { code, stdout, stderr }
  }
}

const MISSING = /not found|does not exist|\b10007\b/i
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

/** O primeiro JSON da saída (o wrangler às vezes imprime avisos antes). */
function jsonOf(text: string): unknown {
  const start = text.search(/[[{]/)
  if (start === -1) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

/** `wrangler secret list --format json`. null se o formato não for o esperado. */
export function parseSecretNames(output: string): string[] | null {
  const data = jsonOf(output)
  if (!Array.isArray(data) || !data.every((item) => typeof item?.name === 'string')) return null
  return data.map((item: { name: string }) => item.name)
}

/** `wrangler versions list --json`. null se o formato não for o esperado. */
export function parseVersions(output: string): ProviderVersion[] | null {
  const data = jsonOf(output)
  if (!Array.isArray(data)) return null
  const versions: ProviderVersion[] = []
  for (const item of data) {
    if (typeof item?.id !== 'string' || typeof item?.number !== 'number') return null
    const annotations = (item.annotations ?? {}) as Record<string, string>
    const metadata = (item.metadata ?? {}) as Record<string, string>
    const tag = annotations['workers/tag'] ?? ''
    const triggeredBy = annotations['workers/triggered_by'] ?? ''
    versions.push({
      id: item.id,
      number: item.number,
      createdAt: metadata.created_on ?? '',
      // `versions secret bulk` gera triggered_by=version_upload: a marca é a referência.
      origin: tag && triggeredBy !== 'secret' ? 'tool' : 'outside',
      author: metadata.author_email ?? '',
      source: metadata.source ?? '',
    })
  }
  return versions
}

export function cloudflareWorker(options: CloudflareWorkerOptions): Provider {
  const run = options.run ?? bunRunner(options.cwd, options.wrangler ?? 'wrangler')
  const scope = ['--name', options.worker, ...(options.env ? ['--env', options.env] : [])]
  const target = `cloudflare:${options.worker}`

  async function call(args: string[], failure: string, stdin?: string): Promise<string> {
    const result = await run([...args, ...scope], stdin)
    const output = result.stdout + result.stderr
    if (result.code !== 0) {
      if (MISSING.test(output)) throw new TargetMissingError(`${failure}: o Worker ${options.worker} não existe na Cloudflare (publique uma vez antes)`)
      throw new SecretsError(`${failure} (código ${result.code}); confira o login (wrangler login ou CLOUDFLARE_API_TOKEN)`)
    }
    return output
  }

  async function listVersions(): Promise<ProviderVersion[]> {
    const versions = parseVersions(await call(['versions', 'list', '--json'], 'não consegui ler as versões'))
    if (!versions) throw new SecretsError('lista de versões do Worker em formato inesperado')
    return versions
  }

  return {
    target,
    async listNames() {
      const names = parseSecretNames(await call(['secret', 'list', '--format', 'json'], 'não consegui ler os nomes dos segredos'))
      if (!names) throw new SecretsError('lista de segredos do Worker em formato inesperado')
      return names
    },
    listVersions,
    async push(values, meta): Promise<VersionRef> {
      // Os valores só passam pela entrada do processo, nunca pela linha de comando.
      const output = await call(['versions', 'secret', 'bulk', '--message', meta.message, '--tag', meta.tag], 'o envio dos segredos falhou', JSON.stringify(values))
      const id = /Created version ([0-9a-f-]{36})/.exec(output)?.[1] ?? UUID.exec(output)?.[0]
      if (!id) throw new SecretsError('o wrangler não disse qual versão criou; o registro não foi atualizado')
      const version = (await listVersions()).find((item) => item.id === id)
      if (!version) throw new SecretsError(`versão ${id} criada, mas não aparece na lista do Worker; o registro não foi atualizado`)
      return { id: version.id, number: version.number, createdAt: version.createdAt }
    },
  }
}
