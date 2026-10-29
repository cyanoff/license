import { base64UrlToBytes, bytesToBase64Url, utf8 } from './encoding.js'
import type { LicensePayload } from './types.js'

export interface ParsedKey {
  prefix: string
  /** The exact bytes that were signed: `<prefix>/<payload-b64>`. */
  signedPart: string
  payloadB64: string
  signature: Uint8Array
}

/**
 * Split `<prefix>/<payload-b64url>.<signature-b64url>`.
 * The prefix may itself contain `/`; the last `/` separates it from the body.
 */
export function parseKey(key: string): ParsedKey | null {
  const trimmed = key.trim()
  const slash = trimmed.lastIndexOf('/')
  if (slash <= 0) return null
  const prefix = trimmed.slice(0, slash)
  const body = trimmed.slice(slash + 1)
  const dot = body.indexOf('.')
  if (dot <= 0 || dot !== body.lastIndexOf('.')) return null
  const payloadB64 = body.slice(0, dot)
  try {
    const sigB64 = body.slice(dot + 1)
    const signature = base64UrlToBytes(sigB64)
    // reject non-canonical encodings so one license has exactly one textual form
    if (bytesToBase64Url(signature) !== sigB64) return null
    if (bytesToBase64Url(base64UrlToBytes(payloadB64)) !== payloadB64) return null
    return { prefix, signedPart: `${prefix}/${payloadB64}`, payloadB64, signature }
  } catch {
    return null
  }
}

export function encodePayload(payload: LicensePayload): string {
  return bytesToBase64Url(utf8.encode(JSON.stringify(payload)))
}

/** Decode a payload without checking anything. Returns null when it is not a well-formed v1 payload. */
export function decodePayload(payloadB64: string): LicensePayload | null {
  let data: unknown
  try {
    data = JSON.parse(utf8.decode(base64UrlToBytes(payloadB64)))
  } catch {
    return null
  }
  return isPayload(data) ? data : null
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function isPayload(d: unknown): d is LicensePayload {
  if (!d || typeof d !== 'object') return false
  const p = d as Record<string, unknown>
  return (
    typeof p.v === 'number' &&
    typeof p.id === 'string' &&
    isStringArray(p.hosts) &&
    isStringArray(p.features) &&
    (p.type === 'annual' || p.type === 'perpetual' || p.type === 'evaluation') &&
    typeof p.exp === 'string' &&
    !Number.isNaN(parseDate(p.exp)) &&
    typeof p.iat === 'string' &&
    (p.watermark === undefined || typeof p.watermark === 'boolean') &&
    (p.maxVersion === undefined || typeof p.maxVersion === 'string') &&
    (p.sub === undefined || typeof p.sub === 'string')
  )
}

/** Parse an ISO date. A bare `YYYY-MM-DD` means the *end* of that day in UTC. */
export function parseDate(s: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(`${s}T23:59:59.999Z`)
  return Date.parse(s)
}
