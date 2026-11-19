// Registro em JSON, versionado no Git ao lado do projeto (`secrets/<ambiente>.json`).
// Escreve num temporário e renomeia: nunca fica pela metade.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { SecretsError, type RegistryStore, type SecretsRegistry } from '../core/types'

export function jsonRegistry(path: string): RegistryStore {
  return {
    label: path,
    async read() {
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new SecretsError(`${path} não é JSON; corrija pelo histórico do Git`)
      }
    },
    async write(registry: SecretsRegistry) {
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`
      try {
        await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
        await rename(temporary, path)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    },
  }
}
