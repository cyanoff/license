import type { LicenseResult } from './types.js'

/** What the host product should do with a verification result. */
export interface Enforcement {
  /** Render attribution / watermark. */
  showWatermark: boolean
  /** Refuse to run (render nothing / throw). Never true in development. */
  block: boolean
  /** Features the product may enable. */
  features: string[]
  /** Human-readable notes, suitable for `console.warn`. */
  messages: string[]
}

export type PolicyName = 'watermark' | 'feature-gate' | 'block' | 'warn'
export type EnforcementPolicy = PolicyName | ((result: LicenseResult) => Enforcement)

export function describeResult(result: LicenseResult): string[] {
  const out: string[] = []
  const p = result.problems
  if (p.includes('no-key')) out.push('No license key provided.')
  if (p.includes('malformed')) out.push('License key is malformed.')
  if (p.includes('wrong-prefix')) out.push('License key belongs to a different product.')
  if (p.includes('bad-signature')) out.push('License key signature is invalid.')
  if (p.includes('unsupported-version')) out.push('License key format is not supported by this version.')
  if (p.includes('host-mismatch')) out.push(`License key is not valid for host "${result.hostname ?? 'unknown'}".`)
  if (p.includes('expired')) out.push('License key has expired.')
  if (p.includes('version-not-covered')) out.push('This product version was released after your perpetual license ended.')
  if (result.inGracePeriod) out.push('License expired recently; running in grace period. Please renew.')
  if (result.state === 'unlicensed' && result.isDevelopment) out.push('Development environment detected: running unlicensed is allowed here.')
  if (result.state === 'unlicensed-production') out.push('A valid license key is required for production use.')
  return out
}

const NOT_ENFORCED_IN_DEV: LicenseResult['state'][] = ['unlicensed-production', 'expired']

/** Turn a result into concrete actions according to a built-in or custom policy. */
export function resolveEnforcement(result: LicenseResult, policy: EnforcementPolicy = 'watermark'): Enforcement {
  if (typeof policy === 'function') {
    const e = policy(result)
    return result.isDevelopment ? { ...e, block: false } : e
  }
  const messages = describeResult(result)
  const features = result.features
  const fullyLicensed = result.state === 'licensed'
  switch (policy) {
    case 'watermark':
      return { showWatermark: !fullyLicensed, block: false, features, messages }
    case 'feature-gate':
      return { showWatermark: result.state === 'licensed-with-watermark', block: false, features, messages }
    case 'block': {
      const block = !result.isDevelopment && NOT_ENFORCED_IN_DEV.includes(result.state)
      return { showWatermark: !fullyLicensed && !block, block, features, messages }
    }
    case 'warn':
      return { showWatermark: false, block: false, features, messages }
  }
}
