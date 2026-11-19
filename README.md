# secrets

Envia segredos ao provedor (Cloudflare Workers hoje; outros por adaptador) sem nunca imprimir valores. Compara o `.env` local com impressões argon2id guardadas num registro versionado no Git, detecta troca feita fora (painel, outro comando) e só envia o que mudou ou falta. Zero dependência em tempo de execução.

```ts
import { createSecretsManager, FINGERPRINT_KEY_NAME, generateFingerprintKey, memoryProvider, memoryRegistry } from '@mvcc-kit/secrets'
import { bunArgon2 } from '@mvcc-kit/secrets/hashers/bun'
import { envObject } from '@mvcc-kit/secrets/sources/env-file'

const manager = createSecretsManager({
  environment: 'production',
  provider: memoryProvider(), // cloudflareWorker({ worker: 'meu-worker' }) em produção
  local: envObject({ API_TOKEN: 'tok_falso', [FINGERPRINT_KEY_NAME]: generateFingerprintKey() }),
  registry: memoryRegistry(), // jsonRegistry('secrets/production.json')
  hasher: bunArgon2({ memoryCost: 1024, timeCost: 1 }),
  secrets: { API_TOKEN: {} },
})
const context = await manager.inspect()
await manager.push(context, context.plan.offer)
```

## Por que

- **Sem gerenciar à mão.** Valor igual ao já enviado não vai de novo; valor que só existe no provedor fica como está.
- **Troca de fora aparece.** Quem trocou pelo painel, e quando, aparece no plano.
- **Nenhum valor em lugar nenhum.** Nem no terminal, nem no registro, nem em erro, nem na linha de comando.
- **Peças trocáveis.** Provedor, origem dos valores, registro e hash são arquivos separados; uma API que muda é um arquivo que muda.

## Instalar

```json
{ "dependencies": { "@mvcc-kit/secrets": "github:mvcc-kit/secrets#v0.1.1-beta" } }
```

## Documentação

- [`SKILL.md`](SKILL.md): guia completo (também em [`llms.txt`](llms.txt), para agentes de IA).
- [`ADR.md`](ADR.md): decisões e o que ficou de fora.
- [`AGENTS.md`](AGENTS.md): regras para quem mexe na biblioteca.
- [`CHANGELOG.md`](CHANGELOG.md) e [`RELEASING.md`](RELEASING.md): versões.

## Licença

MIT.
