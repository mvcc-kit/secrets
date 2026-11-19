// Linha de comando pronta para o `scripts/secrets.ts` de um projeto:
//
//   check                                  mostra o plano; sai com 1 se houver problema
//   push [--names=A,B] [--unlock=A] [--yes]  envia (sem --names: tudo o que pode ir)
//
// Sem --yes, pergunta antes de enviar. Valores nunca aparecem.
import { createInterface } from 'node:readline/promises'
import type { SecretsManager } from './core/manager'
import { planReport } from './core/plan'
import { SecretsError } from './core/types'

export interface CliOptions {
  /** Pergunta sim/não. Padrão: o terminal. */
  confirm?: (question: string) => Promise<boolean>
  log?: (line: string) => void
  color?: boolean
}

async function terminalConfirm(question: string): Promise<boolean> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return /^s(im)?$/i.test((await terminal.question(`${question} (s/N) `)).trim())
  } finally {
    terminal.close()
  }
}

const FLAG_NAME = /^[A-Z][A-Z0-9_]*$/

export function parseCliArgs(argv: readonly string[]) {
  const [command, ...flags] = argv
  if (command !== 'check' && command !== 'push') throw new SecretsError('uso: check | push [--names=A,B] [--unlock=NOME] [--yes]')
  const unlock: string[] = []
  let names: string[] | null = null
  let yes = false
  for (const flag of flags) {
    const [key, value = ''] = flag.split('=', 2)
    if (key === '--unlock' && FLAG_NAME.test(value)) unlock.push(value)
    else if (key === '--names' && command === 'push' && value.split(',').every((name) => FLAG_NAME.test(name))) names = value.split(',')
    else if (flag === '--yes' && command === 'push') yes = true
    else throw new SecretsError(`argumento inválido: ${flag}`)
  }
  return { command, unlock, names, yes }
}

/** Roda um comando e devolve o código de saída. Erro vira mensagem, nunca pilha com valores. */
export async function runCli(manager: SecretsManager, argv: readonly string[], options: CliOptions = {}): Promise<number> {
  const log = options.log ?? console.log
  const color = options.color ?? (!process.env.NO_COLOR && Boolean(process.stdout.isTTY))
  try {
    const args = parseCliArgs(argv)
    const context = await manager.inspect({ unlock: args.unlock })
    for (const line of planReport(context.plan, new Date(), color)) log(line)
    if (args.command === 'check') return context.plan.problems.length ? 1 : 0
    if (context.plan.problems.length) return 1
    const names = args.names ?? context.plan.offer
    if (!names.length) {
      log('Nada a enviar.')
      return 0
    }
    const confirm = options.confirm ?? terminalConfirm
    if (!args.yes && !(await confirm(`Enviar ${names.join(', ')} para ${context.plan.target}?`))) {
      log('Nada foi enviado.')
      return 1
    }
    const version = await manager.push(context, names)
    log(`Enviados numa versão nova (${version.number}): ${names.join(', ')}.`)
    return 0
  } catch (error) {
    log(error instanceof SecretsError ? error.message : `secrets: falha inesperada (${error instanceof Error ? error.name : 'erro'})`)
    return 1
  }
}
