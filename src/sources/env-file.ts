// Valores locais de um arquivo `.env`. Arquivo comum, sem link simbólico, e só o
// dono lê (permissão 600): segredo em arquivo que outro usuário lê não passa.
import { lstat, readFile } from 'node:fs/promises'
import { parseDotenv } from '../core/dotenv'
import { SecretsError, type LocalSource } from '../core/types'

export interface EnvFileOptions {
  /** Arquivo ausente vira valores vazios (tudo fica "só no provedor"). Padrão: erro. */
  optional?: boolean
  /** Confere a permissão 600. Desligue só onde o sistema não tem permissões Unix. Padrão: true. */
  checkPermissions?: boolean
}

export function envFile(path: string, options: EnvFileOptions = {}): LocalSource {
  return {
    label: path,
    async read() {
      const stat = await lstat(path).catch(() => null)
      if (!stat) {
        if (options.optional) return {}
        throw new SecretsError(`${path} não existe`)
      }
      if (stat.isSymbolicLink() || !stat.isFile()) throw new SecretsError(`${path} precisa ser um arquivo comum, sem link simbólico`)
      if ((options.checkPermissions ?? true) && process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
        throw new SecretsError(`${path} pode ser lido por outros usuários; rode: chmod 600 ${path}`)
      return parseDotenv(await readFile(path, 'utf8'), path)
    },
  }
}

/** Valores de um objeto (ex.: `process.env` no CI). Vazio conta como ausente. */
export function envObject(values: Record<string, string | undefined>, label = 'ambiente'): LocalSource {
  return {
    label,
    async read() {
      return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    },
  }
}
