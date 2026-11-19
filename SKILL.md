---
name: secrets
description: Envia segredos de um projeto ao provedor (Cloudflare Workers hoje; AWS e outros por adaptador) sem nunca imprimir valores. Compara o .env local com impressões argon2id de um registro versionado no Git, detecta troca feita fora (painel, outro comando) e só envia o que mudou ou falta. Use ao configurar o deploy de segredos de um projeto que importa `secrets`, ao escrever o `scripts/secrets.ts` ou o passo de segredos de um `deploy.ts`, ao trocar um segredo, ou ao escrever um provedor, origem, registro ou hash novo.
---

# secrets

Mantém os segredos do provedor iguais aos do arquivo local, sem você conferir na mão, e sem nunca mostrar um valor.

- **Sem valor local, mas já no provedor:** fica como está ("só no provedor"), sem erro.
- **Valor local igual ao já enviado:** não envia de novo ("igual").
- **Valor local diferente:** oferece o envio ("mudou").
- **Trocado fora desta ferramenta** (painel, `wrangler secret put`): avisa quem e quando, e oferece reenviar.

O provedor nunca devolve valores. Para saber se o local mudou, cada envio grava no registro (`secrets/<ambiente>.json`, versionado no Git) uma impressão: `argon2id(HMAC-SHA256(chave, "<ambiente>\0<nome>\0<valor>"))`. Sem a chave (que fica só no arquivo local), o registro não deixa testar palpites; se a chave vazar sozinha, cada palpite ainda custa 64 MiB de memória.

Quatro peças trocáveis; o núcleo não conhece nenhuma:

| Peça | O que faz | Prontas |
|---|---|---|
| **Provider** | Onde os segredos ficam | `cloudflareWorker` (wrangler), `memoryProvider` |
| **LocalSource** | De onde vêm os valores | `envFile` (`.env`, só com permissão 600), `envObject` (ex.: `process.env` no CI) |
| **RegistryStore** | Onde ficam as impressões | `jsonRegistry` (arquivo no Git), `memoryRegistry` |
| **Hasher** | Hash lento com sal | `bunArgon2` |

## Instalar

Pelo GitHub, fixado numa tag (nunca num branch):

```json
{ "dependencies": { "@mvcc-kit/secrets": "github:mvcc-kit/secrets#v0.1.1-beta" } }
```

## Usar num projeto (Cloudflare Workers)

Arquivos do projeto:

- `.env.production` (fora do Git, `chmod 600`): os valores e a `SECRETS_FINGERPRINT_KEY` do ambiente (64 hexadecimais; nunca vai ao provedor).
- `secrets/production.json` (no Git): criado no primeiro envio, só com impressões, datas, autores e versões.

```ts
// exemplo: só tipos
import { createSecretsManager } from '@mvcc-kit/secrets'
import { runCli } from '@mvcc-kit/secrets/cli'
import { bunArgon2 } from '@mvcc-kit/secrets/hashers/bun'
import { cloudflareWorker } from '@mvcc-kit/secrets/providers/cloudflare'
import { jsonRegistry } from '@mvcc-kit/secrets/registries/json-file'
import { envFile } from '@mvcc-kit/secrets/sources/env-file'

const root = new URL('..', import.meta.url).pathname
const manager = createSecretsManager({
  environment: 'production',
  provider: cloudflareWorker({ worker: 'meu-worker', cwd: root }),
  local: envFile(`${root}.env.production`),
  registry: jsonRegistry(`${root}secrets/production.json`),
  hasher: bunArgon2(),
  secrets: {
    DATABASE_URL: { check: (v) => (v.startsWith('libsql://') ? null : 'precisa ser libsql://') },
    DATABASE_TOKEN: {},
    SESSION_SECRET: { check: (v) => (v.length >= 32 ? null : '32+ caracteres'), locked: 'derruba todas as sessões abertas.' },
    WEBHOOK_URL: { required: false },
  },
  commit: Bun.spawnSync(['git', 'rev-parse', '--short=12', 'HEAD']).stdout.toString().trim(),
  actor: () => Bun.spawnSync(['git', 'config', 'user.email']).stdout.toString().trim(),
})
process.exitCode = await runCli(manager, Bun.argv.slice(2)) // check | push [--names=A,B] [--unlock=A] [--yes]
```

Gerar a chave do ambiente (uma vez por ambiente; guarde no `.env.<ambiente>`). Sem importar pacote nenhum, então não depende de onde o comando roda:

```sh
openssl rand -hex 32
```

No `cloudflareWorker`, o envio cria uma versão do Worker **sem tráfego** com os segredos novos (`wrangler versions secret bulk`); o deploy seguinte herda os segredos dela. O deploy precisa publicar com `wrangler deploy --tag <commit>`: versão sem marca é tratada como troca de fora. O Worker precisa existir antes do primeiro envio (`TargetMissingError`): publique uma vez antes.

## Dentro de um deploy

```ts
// exemplo: só tipos
import { planReport, TargetMissingError, type SecretsManager } from '@mvcc-kit/secrets'

declare const manager: SecretsManager
declare function firstDeploy(): Promise<void>
declare function confirm(question: string): Promise<boolean>

let context = await manager.inspect().catch(async (error) => {
  if (!(error instanceof TargetMissingError)) throw error
  await firstDeploy() // Worker novo: cria, e só então os segredos podem ir
  return manager.inspect()
})
console.log(planReport(context.plan, new Date()).join('\n'))
if (context.plan.problems.length) throw new Error('segredos com problema; nada publicado')
if (context.plan.offer.length && (await confirm(`Enviar ${context.plan.offer.join(', ')}?`))) await manager.push(context, context.plan.offer)
```

## Situações do plano

| Situação | Quando | Vai no envio? |
|---|---|---|
| `new` (novo) | Ainda não está no provedor | sim |
| `changed` (mudou) | Local diferente da impressão registrada | sim (travado: só destravado) |
| `unverified` (sem registro) | No provedor, mas sem impressão conferível (primeiro uso, troca de fora, chave nova) | sim |
| `same` (igual) | Local igual à impressão | não |
| `remote-only` (só no provedor) | Sem valor local; fica como está | não |
| `missing` (falta) | Obrigatório, sem valor local nem no provedor | bloqueia |
| `extra` (sobra) | No provedor, mas não declarado | não; remova pelo provedor |

Bloqueiam o envio: chave de impressão ausente, obrigatório faltando, valor local recusado pelo `check`, segredo travado que mudou sem destravar, registro de outro ambiente ou alvo.

## Exemplo completo (em memória)

```ts
import { createSecretsManager, FINGERPRINT_KEY_NAME, generateFingerprintKey, memoryProvider, memoryRegistry } from '@mvcc-kit/secrets'
import { bunArgon2 } from '@mvcc-kit/secrets/hashers/bun'
import { envObject } from '@mvcc-kit/secrets/sources/env-file'

const provider = memoryProvider('memory:demo')
const registry = memoryRegistry()
const key = generateFingerprintKey()
const manager = (local: Record<string, string>) =>
  createSecretsManager({
    environment: 'production',
    provider,
    local: envObject({ ...local, [FINGERPRINT_KEY_NAME]: key }),
    registry,
    hasher: bunArgon2({ memoryCost: 1024, timeCost: 1 }),
    secrets: { API_TOKEN: {}, WEBHOOK_URL: { required: false } },
  })

const first = manager({ API_TOKEN: 'tok_um' })
const plan1 = await first.inspect()
console.assert(plan1.plan.offer.join() === 'API_TOKEN')
await first.push(plan1, plan1.plan.offer)

// Mesmo valor: nada a enviar. Valor novo: só ele.
console.assert((await manager({ API_TOKEN: 'tok_um' }).inspect()).plan.offer.length === 0)
const changed = await manager({ API_TOKEN: 'tok_dois' }).inspect()
console.assert(changed.plan.items[0]!.status === 'changed')

// Sem valor local: fica como está, sem erro.
const remoteOnly = await manager({}).inspect()
console.assert(remoteOnly.plan.items[0]!.status === 'remote-only' && remoteOnly.plan.problems.length === 0)

// Troca pelo painel: aviso e reenvio oferecido.
provider.changeOutside('API_TOKEN', 'tok_do_painel')
const outside = await manager({ API_TOKEN: 'tok_um' }).inspect()
console.assert(outside.plan.warnings.some((w) => w.includes('FORA desta ferramenta')))
```

## Segurança

- Valores só passam por `LocalSource.read` → `Provider.push`. Não aparecem no plano, no contexto devolvido por `inspect` (ficam presos a ele, fora do objeto), no registro nem em mensagens de erro. No Cloudflare, vão pela entrada do processo, nunca pela linha de comando.
- `envFile` recusa link simbólico e arquivo que outro usuário lê (exige `chmod 600`).
- O registro é conferido (formato, ambiente e alvo). Impressão adulterada vale como "mudou", nunca passa como "igual".
- O plano é refeito a cada `inspect`, e cada contexto vale para um envio só.
- O `.env` é lido pelo parser próprio: nome repetido e aspas sem fechamento são erro com a linha, nunca um valor adivinhado.

## Peça nova (AWS, Vercel, outro cofre)

Um provedor novo é um arquivo que implementa `Provider`: `target` estável (vai no registro), `listNames()`, `push(values, meta)` devolvendo a versão criada e, se o provedor tiver histórico, `listVersions()` com `origin: 'tool' | 'outside'` (sem ele, o plano avisa que troca de fora não é detectada). Use `memoryProvider` (`src/providers/memory.ts`) como molde e a bateria de `tests/manager.test.ts` para conferir.

```ts
import type { Provider } from '@mvcc-kit/secrets'

// Molde: guarda em memória. Um provedor real chamaria a API (nunca devolvendo valores).
export function myProvider(): Provider {
  const names = new Set<string>()
  let number = 0
  return {
    target: 'meu-cofre:app',
    listNames: async () => [...names],
    push: async (values) => {
      for (const name of Object.keys(values)) names.add(name)
      number += 1
      return { id: `v${number}`, number, createdAt: new Date(0).toISOString() }
    },
  }
}
console.assert(myProvider().target === 'meu-cofre:app')
```

Decisões e o que ficou de fora: `ADR.md`. O que falta: `TAREFAS.md`.
