# AGENTS.md: guia para agentes que mexem no secrets

`secrets` mantém os segredos do provedor iguais aos do arquivo local, sem nunca mostrar um valor.

## Leia primeiro (5 minutos)

| Arquivo | Para quê |
|---|---|
| `src/index.ts` | Tudo o que é público no núcleo |
| `src/core/types.ts` | Os contratos `Provider`, `LocalSource`, `RegistryStore` e `Hasher` |
| `src/core/plan.ts` | As regras: situação de cada segredo, o que pode ir e o que bloqueia |
| `src/core/manager.ts` | Junta as peças; onde os valores ficam presos ao contexto |
| `src/core/fingerprint.ts` | A impressão (HMAC + argon2id) |
| `src/providers/*`, `src/sources/*`, `src/registries/*`, `src/hashers/*` | As peças prontas |
| `SKILL.md` | Como usar num projeto (gera `llms.txt`) |
| `ADR.md` | Por que cada decisão |

## Regras fixas

1. **Nenhum valor sai do caminho `LocalSource.read` → `Provider.push`.** Nada de valor em plano, contexto, registro, mensagem de erro, log ou argumento de linha de comando. Teste novo que mexe com valores confere isso.
2. **Zero dependência em tempo de execução.** Validação aceita Standard Schema sem depender de nenhuma biblioteca. Dependência nova exige pedido do dono.
3. **O núcleo roda em qualquer lugar.** `src/core/`, `src/index.ts` e as peças em memória não importam `node:*`, `bun:*` nem SDK. `tests/project.test.ts` confere.
4. **Lógica separada da implementação.** Provedor, origem, registro ou hash novo é um arquivo novo, sem mexer no núcleo. API de provedor que muda: o ajuste fica no arquivo do provedor.
5. **Falha fechada.** Na dúvida (registro estranho, versão desconhecida, chave diferente), nada é conferível e o plano avisa; nunca "igual" sem prova.
6. **Testes com dados falsos e determinísticos** (`tests/helpers.ts`, e-mails em `example.test`). Nada de relógio real: `now` falso. Provedor de verdade só por `run` falso.
7. **Compatível com as impressões já gravadas.** A fórmula da impressão não muda sem mudança de formato do registro (`format`) e entrada em "Mudanças de quebra".
8. **Documentação junto com o código.** Mudou a API pública: `SKILL.md` e `bun run docs` no mesmo commit; os blocos ```ts rodam no teste (os que precisam de provedor real começam com `// exemplo: só tipos`).
9. **Código em inglês; comentários, documentação e mensagens em português,** com o prefixo `secrets:`.
10. **Nada privado no repositório.** `bun run leak-check` confere arquivos, histórico e autores; palavras privadas em `.private-words` (fora do Git).
11. **O que a IA acrescenta precisa ser perguntado.** Diga o que foi acrescentado, separado do pedido, e pergunte.

## Antes de terminar

```sh
bun test
bunx tsc --noEmit -p .
bun run leak-check
```

Depois teste num projeto que usa a biblioteca. Mudança que vai para quem usa: siga [`RELEASING.md`](RELEASING.md). Nunca crie, mova ou apague tag à mão.
