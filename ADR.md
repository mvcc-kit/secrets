# ADR: secrets

Decisões técnicas: o que foi escolhido, por quê e o que foi descartado. Origem: um gerenciador de segredos de Workers usado em produção, extraído e generalizado em 19/11/2026.

## S1: Quatro peças, núcleo puro

Provedor (onde os segredos ficam), origem local (de onde vêm os valores), registro (onde ficam as impressões) e hash. O núcleo (`src/core`) só conhece os contratos e não importa Node, Bun nem SDK.

**Por quê.** Cada eixo muda por um motivo: a CLI ou a API do provedor muda; o projeto troca de provedor (Cloudflare → AWS); os valores vêm do `.env` no computador e do ambiente no CI; o registro pode ir para outro lugar.

**Descartado.** Um gerenciador amarrado ao wrangler e a ambientes fixos (`preview`/`production`), com o nome do Worker derivado por convenção.

## S2: Impressão = argon2id(HMAC-SHA256(chave, ambiente\0nome\0valor))

- HMAC com chave de 256 bits que fica só no arquivo local: sem ela, o registro (público no Git do projeto) não deixa testar palpites, nem de valores curtos.
- argon2id (64 MiB, 3 passadas, sal aleatório): se a chave vazar sozinha, cada palpite ainda custa memória e tempo.
- Ambiente e nome na mensagem: o mesmo valor em dois ambientes, ou com dois nomes, gera impressões sem relação.
- `keyCheck`: impressão de um texto fixo; diz se a chave local é a mesma do registro.

A fórmula é a mesma do gerenciador de origem: registros já gravados continuam conferíveis.

**Descartado.** Guardar o valor cifrado no registro (o registro viraria um cofre a proteger); SHA-256 puro (palpites baratos).

## S3: O que o plano decide

| Situação | Envio |
|---|---|
| novo, mudou, sem registro | oferecido |
| igual, só no provedor | não |
| falta (obrigatório) | bloqueia |
| sobra (no provedor, não declarado) | aviso; remoção manual |

"Só no provedor" não é erro: o segredo já enviado continua valendo sem cópia local. Só avisa quando nem dá para conferir.

## S4: Troca feita fora

O provedor informa as versões (`listVersions`) com a origem: `tool` (criada por esta ferramenta ou por deploy marcado) ou `outside`. Versão de fora depois da última registrada: aviso com autor e data, e nenhuma impressão vale até o próximo envio. Numeração que recomeçou, ou mesmo número com outro ID: alvo recriado, mesma desconfiança. Provedor sem versões: aviso fixo de que troca de fora não é detectada.

No Cloudflare, a marca é `workers/tag` (o deploy precisa publicar com `--tag`); `workers/triggered_by: secret` é sempre de fora.

## S5: Valores presos ao contexto

`inspect()` devolve plano, registro e flags. Os valores ficam num `WeakMap` interno, ligados àquele contexto, e saem só em `push(contexto, nomes)`. Cada contexto vale para um envio: o próximo exige um plano novo.

**Por quê.** Um `console.log(contexto)` ou um `JSON.stringify` por engano não vaza nada; e não se envia com um plano velho.

## S6: Segredo travado

`locked: '<consequência>'` num segredo: se o valor local **mudou** em relação à impressão, o plano bloqueia até destravar (`unlock`). Sem impressão conferível, a confirmação mostra a consequência.

## S7: Parser de `.env` próprio

Formato pequeno e fechado (`NOME=valor`, `export`, aspas simples literais, aspas duplas com escapes e várias linhas, comentário depois de espaço). Nome repetido, aspas sem fechamento e texto depois das aspas são erro com a linha. `Map` + `Object.fromEntries`: `__proto__` vira chave comum.

**Descartado.** O pacote `dotenv`: dependência, e o último valor repetido vence em silêncio.

## S8: Validação por Standard Schema

`check` aceita uma função (`(valor) => erro | null`) ou qualquer schema que implemente Standard Schema v1 (valibot, zod, arktype...). A interface está copiada em `types.ts`: nenhuma dependência.

## S9: Fora do pacote

| Ideia | Por quê |
|---|---|
| Remover segredo que sobra | Remoção é decisão humana, no provedor |
| Ler valores do provedor | Nenhum provedor sério devolve; e não deveria |
| Gerar valores | Cada segredo tem a própria origem (painel do provedor, `openssl`) |
