import { importPublicKey, verifySignature } from './crypto.js'
import { utf8 } from './encoding.js'
import { detectDevelopment, readRuntime } from './environment.js'
import { anyHostMatches } from './hosts.js'
import { decodePayload, parseDate, parseKey } from './key.js'
import type { LicenseConfig, LicensePayload, LicenseProblem, LicenseResult } from './types.js'
import { compareVersions } from './version.js'

const DAY = 24 * 60 * 60 * 1000
export const DEFAULT_GRACE_PERIOD_DAYS = 30

/**
 * Verify a license key fully offline.
 * Never throws for bad input: problems are reported in `result.problems`.
 */
export async function verifyLicense(licenseKey: string | null | undefined, config: LicenseConfig): Promise<LicenseResult> {
  const result = await evaluate(licenseKey, config)
  if (config.telemetry) {
    try {
      config.telemetry({
        state: result.state,
        licenseId: result.payload?.id ?? null,
        hostname: result.hostname,
        version: config.version ?? null,
        isDevelopment: result.isDevelopment,
      })
    } catch {
      // telemetry must never break the host product
    }
  }
  return result
}

/** Bind a config once and verify many keys. */
export function createLicenseVerifier(config: LicenseConfig) {
  return {
    config,
    verify: (licenseKey: string | null | undefined) => verifyLicense(licenseKey, config),
  }
}

async function evaluate(licenseKey: string | null | undefined, config: LicenseConfig): Promise<LicenseResult> {
  const rt = readRuntime()
  const hostname = config.hostname ?? rt.hostname
  const protocol = config.protocol ?? rt.protocol
  const isDevelopment =
    config.environment === 'development'
      ? true
      : config.environment === 'production'
        ? false
        : detectDevelopment({ hostname, protocol, nodeEnv: rt.nodeEnv })

  const problems: LicenseProblem[] = []
  const base = { hostname, isDevelopment, inGracePeriod: false, features: [] as string[] }
  const unlicensed = (problem: LicenseProblem, signatureValid = false, payload: LicensePayload | null = null): LicenseResult => {
    problems.push(problem)
    return {
      ...base,
      state: isDevelopment ? 'unlicensed' : 'unlicensed-production',
      signatureValid,
      payload,
      problems,
    }
  }

  if (!licenseKey || !licenseKey.trim()) return unlicensed('no-key')

  const parsed = parseKey(licenseKey)
  if (!parsed) return unlicensed('malformed')
  if (parsed.prefix !== config.prefix) return unlicensed('wrong-prefix')

  let ok = false
  try {
    const pub = await importPublicKey(config.publicKey)
    ok = await verifySignature(pub, parsed.signature, utf8.encode(parsed.signedPart))
  } catch {
    ok = false
  }
  if (!ok) return unlicensed('bad-signature')

  const payload = decodePayload(parsed.payloadB64)
  if (!payload) return unlicensed('malformed', true)
  if (payload.v !== 1) return unlicensed('unsupported-version', true)

  if (!anyHostMatches(payload.hosts, hostname)) return unlicensed('host-mismatch', true, payload)

  const now = (config.now?.() ?? new Date()).getTime()
  const exp = parseDate(payload.exp)
  let inGracePeriod = false
  let expired = false

  if (payload.type === 'evaluation') {
    expired = now > exp
  } else if (payload.type === 'annual') {
    const grace = (config.gracePeriodDays ?? DEFAULT_GRACE_PERIOD_DAYS) * DAY
    expired = now > exp + grace
    inGracePeriod = !expired && now > exp
  } else {
    // perpetual: any version released on/before the expiry date keeps working forever
    if (config.publishedAt) {
      const published = parseDate(config.publishedAt)
      if (!Number.isNaN(published) && published > exp) problems.push('version-not-covered')
    }
    if (payload.maxVersion && config.version) {
      try {
        if (compareVersions(config.version, payload.maxVersion) > 0) problems.push('version-not-covered')
      } catch {
        problems.push('version-not-covered')
      }
    }
    expired = problems.includes('version-not-covered')
  }

  if (expired) {
    if (!problems.includes('version-not-covered')) problems.push('expired')
    return { ...base, state: 'expired', signatureValid: true, payload, problems }
  }

  const known = config.features
  const features = known ? payload.features.filter((f) => known.includes(f)) : [...payload.features]
  return {
    ...base,
    inGracePeriod,
    features,
    state: payload.watermark ? 'licensed-with-watermark' : 'licensed',
    signatureValid: true,
    payload,
    problems,
  }
}
