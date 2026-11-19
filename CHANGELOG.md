# Changelog

As versões seguem [RELEASING.md](RELEASING.md). Mudança de quebra é permitida no beta e sempre aparece em "Mudanças de quebra".

## 0.1.1-beta (19/11/2026)

### Segurança

- A chave de impressão se gera com `openssl rand -hex 32`, sem importar pacote. O comando antigo (`bun -e "import ... from 'secrets'"`), rodado fora do projeto, fazia o Bun baixar e executar o pacote `secrets` do npm, que é de outra pessoa.
- `bunfig.toml` com `install.auto = "disable"`: o Bun nunca instala pacote sozinho neste repositório.

### Mudanças de quebra

- O pacote agora se chama `@mvcc-kit/secrets` (o nome `secrets` existe no npm). Troque a dependência para `"@mvcc-kit/secrets": "github:mvcc-kit/secrets#v0.1.1-beta"` e os imports de `'secrets'` e `'secrets/...'` para `'@mvcc-kit/secrets'` e `'@mvcc-kit/secrets/...'`.

## 0.1.0-beta (19/11/2026)

### Adicionado

- `createSecretsManager` com `inspect` (plano: novo, mudou, sem registro, igual, só no provedor, falta, sobra) e `push`.
- Impressões `argon2id(HMAC-SHA256(chave, ambiente\0nome\0valor))` num registro versionado; detecção de troca feita fora, de alvo recriado e de chave trocada; segredos travados; aviso de rotação.
- Provedores `cloudflareWorker` (wrangler, versão sem tráfego) e `memoryProvider`; origens `envFile` e `envObject`; registros `jsonRegistry` e `memoryRegistry`; hash `bunArgon2`.
- Validação por função ou por qualquer Standard Schema (valibot, zod...), sem depender deles.
- `runCli` com `check` e `push`.
- `SKILL.md` e `llms.txt` para agentes de IA, com exemplos que rodam no teste.

### Segurança

- Valores ficam presos ao contexto, fora do objeto devolvido: um log do contexto não vaza nada. Cada contexto vale para um envio.
- `.env` só com permissão 600 e sem link simbólico; parser próprio que recusa nome repetido e aspas sem fechamento, e não deixa `__proto__` mexer no protótipo.
- No Cloudflare, os valores vão pela entrada do processo, nunca pela linha de comando.
