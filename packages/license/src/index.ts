export { verifyLicense, createLicenseVerifier, DEFAULT_GRACE_PERIOD_DAYS } from './verify.js'
export { resolveEnforcement, describeResult } from './policy.js'
export type { Enforcement, EnforcementPolicy, PolicyName } from './policy.js'
export { hostMatches, anyHostMatches, normalizeHost } from './hosts.js'
export { detectDevelopment, isLocalHost, readRuntime } from './environment.js'
export type { RuntimeInfo } from './environment.js'
export { parseKey, decodePayload, parseDate } from './key.js'
export { compareVersions } from './version.js'
export type {
  LicenseConfig,
  LicensePayload,
  LicenseProblem,
  LicenseResult,
  LicenseState,
  LicenseType,
  TelemetryEvent,
} from './types.js'

/** Decode a key's payload without verifying it (for display/debugging only; never trust it). */
export { inspectLicense } from './inspect.js'
