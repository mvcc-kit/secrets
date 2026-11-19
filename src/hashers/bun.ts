// argon2id pelo Bun (`Bun.password`). Só Bun; outro ambiente usa outra peça `Hasher`.
import type { Hasher } from '../core/types'

/** 64 MiB e 3 passadas: cada palpite custa memória e tempo. */
export const ARGON2_OPTIONS = { algorithm: 'argon2id', memoryCost: 65_536, timeCost: 3 } as const

export function bunArgon2(options: { memoryCost: number; timeCost: number } = ARGON2_OPTIONS): Hasher {
  const settings = { algorithm: 'argon2id' as const, memoryCost: options.memoryCost, timeCost: options.timeCost }
  return {
    name: `argon2id(m=${settings.memoryCost},t=${settings.timeCost})`,
    hash: (input) => Bun.password.hash(input, settings),
    verify: async (input, hashed) => {
      // Impressão que não é argon2id (registro adulterado) vale como diferente, nunca como erro.
      if (!hashed.startsWith('$argon2id$')) return false
      return Bun.password.verify(input, hashed)
    },
  }
}
