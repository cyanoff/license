import { base64UrlToBytes, bytesToBase64Url } from './encoding.js'

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' } as const

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (!c?.subtle) throw new Error('@cyanoff/license: WebCrypto (crypto.subtle) is not available in this runtime')
  return c.subtle
}

/** Copy into a fresh ArrayBuffer-backed view (keeps TS's BufferSource typing happy everywhere). */
function buf(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.length))
  out.set(bytes)
  return out
}

const publicKeyCache = new Map<string, Promise<CryptoKey>>()

/** Import a raw (65-byte uncompressed) P-256 public key encoded as base64url. Cached per key string. */
export function importPublicKey(publicKey: string): Promise<CryptoKey> {
  let p = publicKeyCache.get(publicKey)
  if (!p) {
    p = (async () => {
      const raw = base64UrlToBytes(publicKey.trim())
      if (raw.length !== 65 || raw[0] !== 0x04) throw new Error('public key must be a 65-byte uncompressed P-256 point')
      return subtle().importKey('raw', buf(raw), ALG, false, ['verify'])
    })()
    publicKeyCache.set(publicKey, p)
    p.catch(() => publicKeyCache.delete(publicKey))
  }
  return p
}

export async function verifySignature(key: CryptoKey, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    return await subtle().verify(SIGN_ALG, key, buf(signature), buf(data))
  } catch {
    return false
  }
}

// ---- issuing side (used by the CLI and tests; never needed in a shipped product) ----

export interface GeneratedKeyPair {
  /** base64url raw public key, safe to embed in product code. */
  publicKey: string
  /** PKCS#8 PEM private key. Keep secret. */
  privateKeyPem: string
}

export async function generateKeyPair(): Promise<GeneratedKeyPair> {
  const pair = (await subtle().generateKey(ALG, true, ['sign', 'verify'])) as CryptoKeyPair
  const raw = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey))
  return { publicKey: bytesToBase64Url(raw), privateKeyPem: toPem(pkcs8) }
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return subtle().importKey('pkcs8', buf(fromPem(pem)), ALG, true, ['sign'])
}

/** Derive the raw base64url public key from a PKCS#8 PEM private key. */
export async function publicKeyFromPrivate(pem: string): Promise<string> {
  const priv = await importPrivateKey(pem)
  const jwk = await subtle().exportKey('jwk', priv)
  const pub = await subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true }, ALG, true, ['verify'])
  return bytesToBase64Url(new Uint8Array(await subtle().exportKey('raw', pub)))
}

export async function sign(privateKey: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle().sign(SIGN_ALG, privateKey, buf(data)))
}

function toPem(der: Uint8Array): string {
  const b64 = btoa(String.fromCharCode(...der))
  const lines = b64.match(/.{1,64}/g) ?? []
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----\n`
}

function fromPem(pem: string): Uint8Array {
  const m = pem.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/)
  if (!m) throw new Error('expected a PKCS#8 "PRIVATE KEY" PEM block')
  const bin = atob(m[1]!.replace(/\s+/g, ''))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}
