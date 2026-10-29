/** Kind of license encoded in a key. */
export type LicenseType = 'annual' | 'perpetual' | 'evaluation'

/** Signed contents of a license key. Field names are kept short to keep keys compact. */
export interface LicensePayload {
  /** Format version. Currently always 1. */
  v: 1
  /** Unique license id (e.g. order id or UUID). */
  id: string
  /** Hostnames the key is valid for. Supports `example.com`, `*.example.com` and `*`. */
  hosts: string[]
  /** Feature names unlocked by this key. */
  features: string[]
  /** License type. */
  type: LicenseType
  /** Expiry date, ISO-8601 (`2027-12-31` or full timestamp). */
  exp: string
  /** Issued-at timestamp, ISO-8601. */
  iat: string
  /** When true, the product should still show attribution/watermark even though the key is valid. */
  watermark?: boolean
  /** Optional cap for perpetual licenses: highest product version covered (semver). */
  maxVersion?: string
  /** Optional free-form licensee label (company or email). Not used for validation. */
  sub?: string
}

export type LicenseState =
  | 'pending'
  | 'licensed'
  | 'licensed-with-watermark'
  | 'unlicensed'
  | 'unlicensed-production'
  | 'expired'

export type LicenseProblem =
  | 'no-key'
  | 'malformed'
  | 'wrong-prefix'
  | 'bad-signature'
  | 'unsupported-version'
  | 'host-mismatch'
  | 'expired'
  | 'version-not-covered'

export interface LicenseResult {
  state: Exclude<LicenseState, 'pending'>
  /** True when the signature checked out (regardless of host/expiry). */
  signatureValid: boolean
  /** Decoded payload when the key could be parsed and its signature is valid. */
  payload: LicensePayload | null
  /** Features that are active right now (empty unless the key is valid for this host and not expired). */
  features: string[]
  /** True when the runtime looks like local development. */
  isDevelopment: boolean
  /** True when an annual license is past `exp` but still inside the grace period. */
  inGracePeriod: boolean
  /** Problems found, in the order they were detected. Empty for a clean license. */
  problems: LicenseProblem[]
  /** Hostname that was checked, if known. */
  hostname: string | null
}

export interface LicenseConfig {
  /** Product public key: base64url of the uncompressed P-256 point (65 bytes), as printed by `cyanoff-license keygen`. */
  publicKey: string
  /** Key prefix, e.g. `acme-editor-v1`. Keys must look like `<prefix>/<payload>.<signature>`. */
  prefix: string
  /** Feature names this product knows about. Unknown names in a key are ignored. Omit to accept all. */
  features?: readonly string[]
  /** Grace period for annual licenses, in days. Default 30. */
  gracePeriodDays?: number
  /** Current product version (semver). Used for perpetual `maxVersion` checks. */
  version?: string
  /** Release date of the running product version (ISO-8601). Perpetual keys cover versions published on/before `exp`. */
  publishedAt?: string
  /** Override environment detection. Default `auto`. */
  environment?: 'auto' | 'development' | 'production'
  /** Override the hostname (default: `location.hostname` in browsers, none in Node). */
  hostname?: string
  /** Override the protocol (default: `location.protocol` in browsers). */
  protocol?: string
  /** Clock override for tests. */
  now?: () => Date
  /**
   * Opt-in telemetry. Called once per verification with a minimal event. Off unless you pass a function.
   * You are responsible for disclosing it to your users.
   */
  telemetry?: (event: TelemetryEvent) => void
}

export interface TelemetryEvent {
  state: LicenseResult['state']
  licenseId: string | null
  hostname: string | null
  version: string | null
  isDevelopment: boolean
}
