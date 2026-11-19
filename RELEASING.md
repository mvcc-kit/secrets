# Como publicar uma versão

Uma versão é uma tag no GitHub, com uma release que diz o que mudou. Quem usa instala assim, sem npm:

```json
{ "dependencies": { "@mvcc-kit/secrets": "github:mvcc-kit/secrets#v0.1.0-beta" } }
```

## As regras

1. **A versão sobe de 1 em 1:** `0.1.0-beta`, `0.1.1-beta`, `0.1.2-beta`. Sem pular número.
2. **Por enquanto, mudança de quebra é permitida.** Ela usa o mesmo número seguinte e sempre aparece em "Mudanças de quebra", com o que fazer.
3. **Toda versão diz o que mudou,** em itens, com estes títulos:
   - `### Adicionado`
   - `### Melhorado`
   - `### Corrigido`
   - `### Segurança`
   - `### Mudanças de quebra`

   Use só os títulos que tiverem itens. O texto vai do `CHANGELOG.md` para a release.
4. **Subir devagar:** junte as mudanças em vez de publicar uma versão para cada uma.
5. **Só publique o que foi testado em um projeto real.** A versão nova entra no app antes de receber outra por cima.
6. **Tag publicada não muda nem é apagada.** Versão ruim se corrige com a seguinte.
7. **Só o comando cria tag.** Nada de `git tag` à mão.
8. **Nome com escopo, sempre `@mvcc-kit/<nome>`.** Nome sem escopo pode existir no npm: fora do projeto, o Bun instalaria e rodaria o pacote de um estranho.
9. **Nada privado no repositório.** Ele é público, inclusive o histórico: nome de cliente, caminho de outro projeto e segredo ficam de fora.

O comando recusa número errado e notas sem título ou sem itens.

## O fluxo

1. **Mude** o código, com teste, e leve para `main`.
2. **Descreva** no topo do `CHANGELOG.md`, e faça commit:

   ```markdown
   ## 0.1.1-beta (DD/MM/AAAA)

   ### Corrigido

   - O que foi corrigido, em uma frase.
   ```

3. **Ensaie:** `bun run release 0.1.1-beta --dry-run`.
4. **Publique:** `bun run release 0.1.1-beta`.
5. **Atualize quem usa:** troque a tag no `package.json` do projeto, rode `bun install` e os testes dele.

## O que o comando faz

Nesta ordem, e para no primeiro erro:

1. Confere: `main`, sem mudanças soltas, igual ao GitHub, número certo e notas.
2. Procura dados privados nos arquivos, no histórico inteiro e nos autores dos commits (`bun run leak-check`), com as palavras de `.private-words`.
3. Roda testes e tipos.
4. Instala o que está no Git num projeto vazio e importa todas as entradas públicas.
5. Grava o número em `package.json`, faz o commit e cria a tag anotada.
6. Envia commit e tag juntos.
7. Cria a release no GitHub, marcada como pré-lançamento.

## Sair do beta

A `1.0.0` é o único salto permitido. Exige pelo menos um app real em produção com o secrets e 30 dias sem mudança de quebra. Depois dela, mudança de quebra deixa de ser livre, e estas regras serão revistas.
