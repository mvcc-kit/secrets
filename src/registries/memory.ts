// Registro em memória: testes e exemplos. Roda em qualquer lugar.
import type { RegistryStore, SecretsRegistry } from '../core/types'

/** Registro em memória (testes). */
export function memoryRegistry(start: SecretsRegistry | null = null): RegistryStore & { current(): SecretsRegistry | null } {
  let stored: SecretsRegistry | null = start === null ? null : structuredClone(start)
  return {
    label: 'registro em memória',
    async read() {
      return stored === null ? null : structuredClone(stored)
    },
    async write(registry) {
      stored = structuredClone(registry)
    },
    current: () => stored,
  }
}
