/**
 * Issuing helpers. Import from `@cyanoff/license/issuer` on your build/sales server or CLI only;
 * product code should never ship a private key.
 */
import { generateKeyPair, importPrivateKey, publicKeyFromPrivate, sign } from './crypto.js'
import { bytesToBase64Url, utf8 } from './encoding.js'
import { encodePayload, parseDate } from './key.js'
import type { LicensePayload, LicenseType } from './types.js'

export { generateKeyPair, publicKeyFromPrivate }
export type { GeneratedKeyPair } from './crypto.js'

export interface IssueOptions {
  privateKeyPem: string
  prefix: string
  id?: string
  hosts: string[]
  features?: string[]
  type?: LicenseType
  /** ISO date or timestamp. */
  expires: string
  watermark?: boolean
  maxVersion?: string
  sub?: string
  issuedAt?: Date
}

export async function issueLicense(opts: IssueOptions): Promise<string> {
  if (!opts.prefix || /\s/.test(opts.prefix)) throw new Error('prefix must be a non-empty string without whitespace')
  if (!opts.hosts.length) throw new Error('at least one host is required (use "*" for any host)')
  if (Number.isNaN(parseDate(opts.expires))) throw new Error(`invalid expiry date: ${opts.expires}`)
  const payload: LicensePayload = {
    v: 1,
    id: opts.id ?? globalThis.crypto.randomUUID(),
    hosts: opts.hosts,
    features: opts.features ?? [],
    type: opts.type ?? 'annual',
    exp: opts.expires,
    iat: (opts.issuedAt ?? new Date()).toISOString(),
  }
  if (opts.watermark) payload.watermark = true
  if (opts.maxVersion) payload.maxVersion = opts.maxVersion
  if (opts.sub) payload.sub = opts.sub
  const signedPart = `${opts.prefix}/${encodePayload(payload)}`
  const key = await importPrivateKey(opts.privateKeyPem)
  const sig = await sign(key, utf8.encode(signedPart))
  return `${signedPart}.${bytesToBase64Url(sig)}`
}
