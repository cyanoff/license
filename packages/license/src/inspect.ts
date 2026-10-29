import { decodePayload, parseKey } from './key.js'
import type { LicensePayload } from './types.js'

export function inspectLicense(licenseKey: string): { prefix: string; payload: LicensePayload | null } | null {
  const parsed = parseKey(licenseKey)
  if (!parsed) return null
  return { prefix: parsed.prefix, payload: decodePayload(parsed.payloadB64) }
}
