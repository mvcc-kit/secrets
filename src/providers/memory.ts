// Provedor em memória: testes, exemplos e o molde de um provedor novo.
import type { Provider, ProviderVersion, VersionRef } from '../core/types'

export interface MemoryProvider extends Provider {
  /** Só para testes: o que está guardado. Um provedor de verdade nunca devolve valores. */
  readonly stored: Map<string, string>
  readonly versions: ProviderVersion[]
  /** Simula uma troca feita fora (painel, outro comando). */
  changeOutside(name: string, value: string, author?: string): void
}

export function memoryProvider(target = 'memory', start: Record<string, string> = {}): MemoryProvider {
  const stored = new Map(Object.entries(start))
  const versions: ProviderVersion[] = []
  let clock = Date.UTC(2026, 0, 1)
  const nextVersion = (origin: ProviderVersion['origin'], author: string): ProviderVersion => {
    clock += 60_000
    const number = versions.length + 1
    const version: ProviderVersion = {
      id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
      number,
      createdAt: new Date(clock).toISOString(),
      origin,
      author,
      source: origin === 'tool' ? 'secrets' : 'dashboard',
    }
    versions.push(version)
    return version
  }
  return {
    target,
    stored,
    versions,
    async listNames() {
      return [...stored.keys()].sort()
    },
    async listVersions() {
      return versions.map((version) => ({ ...version }))
    },
    async push(values): Promise<VersionRef> {
      for (const [name, value] of Object.entries(values)) stored.set(name, value)
      const { id, number, createdAt } = nextVersion('tool', 'tool@example.test')
      return { id, number, createdAt }
    },
    changeOutside(name, value, author = 'someone@example.test') {
      stored.set(name, value)
      nextVersion('outside', author)
    },
  }
}
