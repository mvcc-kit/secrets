// Impressão de um segredo: dá para saber se o valor local mudou sem guardar o valor.
//
//   impressão = argon2id( HMAC-SHA256(chave, "<ambiente>\0<nome>\0<valor>") )
//
// - HMAC com chave de 256 bits (fica só no `.env`, nunca vai ao provedor): sem a
//   chave, o registro não deixa testar palpites, nem de valores curtos.
// - argon2id com sal aleatório: se a chave vazar sozinha, cada palpite ainda custa
//   memória e tempo.
// - Ambiente e nome entram na mensagem: o mesmo valor em dois ambientes ou com dois
//   nomes gera impressões sem relação.
// Só Web Crypto aqui; o argon2id é a peça `Hasher`.

import { SecretsError, type Hasher } from './types'

export const FINGERPRINT_KEY_NAME = 'SECRETS_FINGERPRINT_KEY'
const KEY = /^[0-9a-f]{64}$/

/** A chave, ou null se faltar ou não tiver 64 caracteres hexadecimais. */
export function parseFingerprintKey(value: string | undefined): string | null {
  const key = value?.trim().toLowerCase()
  return key && KEY.test(key) ? key : null
}

/** Chave nova: 32 bytes aleatórios em hexadecimal. */
export function generateFingerprintKey(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16))
const bytesToHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

export interface Fingerprinter {
  make(name: string, value: string): Promise<string>
  matches(name: string, value: string, fingerprint: string): Promise<boolean>
  makeKeyCheck(): Promise<string>
  keyMatches(keyCheck: string): Promise<boolean>
}

export function fingerprinter(environment: string, key: string, hasher: Hasher): Fingerprinter {
  if (!KEY.test(key)) throw new SecretsError(`${FINGERPRINT_KEY_NAME} inválida`)
  if (environment.includes('\0')) throw new SecretsError('nome de ambiente inválido')
  const cryptoKey = crypto.subtle.importKey('raw', hexToBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = async (message: string) => bytesToHex(await crypto.subtle.sign('HMAC', await cryptoKey, new TextEncoder().encode(message)))
  const secretMac = (name: string, value: string) => mac(`${environment}\0${name}\0${value}`)
  const keyMac = () => mac(`${environment}\0key-check`)
  return {
    make: async (name, value) => hasher.hash(await secretMac(name, value)),
    matches: async (name, value, fingerprint) => hasher.verify(await secretMac(name, value), fingerprint),
    makeKeyCheck: async () => hasher.hash(await keyMac()),
    keyMatches: async (keyCheck) => hasher.verify(await keyMac(), keyCheck),
  }
}
