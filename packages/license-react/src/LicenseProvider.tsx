import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import {
  resolveEnforcement,
  verifyLicense,
  type Enforcement,
  type EnforcementPolicy,
  type LicenseConfig,
  type LicenseResult,
  type LicenseState,
} from '@cyanoff/license'
import { Watermark } from './Watermark.js'

export interface LicenseContextValue {
  state: LicenseState
  result: LicenseResult | null
  enforcement: Enforcement | null
  features: string[]
}

const PENDING: LicenseContextValue = { state: 'pending', result: null, enforcement: null, features: [] }
const LicenseContext = createContext<LicenseContextValue | null>(null)

export interface LicenseProviderProps {
  config: LicenseConfig
  licenseKey?: string | null
  /** Default `watermark`. */
  policy?: EnforcementPolicy
  /** Rendered instead of children when the policy blocks. Default: nothing. */
  fallback?: ReactNode
  /** Custom watermark node, or `false` to render none (e.g. you draw your own via `useLicense`). */
  watermark?: ReactNode | false
  /** Log enforcement messages with console.warn. Default true. */
  logMessages?: boolean
  onResult?: (result: LicenseResult, enforcement: Enforcement) => void
  /** Wrapper element style; it is `position: relative` so the watermark can anchor to it. */
  style?: CSSProperties
  className?: string
  children?: ReactNode
}

export function LicenseProvider({
  config,
  licenseKey,
  policy = 'watermark',
  fallback = null,
  watermark,
  logMessages = true,
  onResult,
  style,
  className,
  children,
}: LicenseProviderProps) {
  const [value, setValue] = useState<LicenseContextValue>(PENDING)
  const latest = useRef({ config, policy, onResult, logMessages })
  latest.current = { config, policy, onResult, logMessages }

  // Re-verify only when something that affects the outcome changes (inline config objects are fine).
  const policyKey = typeof policy === 'function' ? 'custom' : policy
  useEffect(() => {
    let cancelled = false
    const { config: cfg, policy: pol } = latest.current
    verifyLicense(licenseKey, cfg).then((result) => {
      if (cancelled) return
      const enforcement = resolveEnforcement(result, pol)
      const cur = latest.current
      if (cur.logMessages && result.state !== 'licensed' && enforcement.messages.length) {
        console.warn(`[license] ${enforcement.messages.join(' ')}`)
      }
      cur.onResult?.(result, enforcement)
      setValue({ state: result.state, result, enforcement, features: enforcement.features })
    })
    return () => {
      cancelled = true
    }
  }, [
    licenseKey,
    policyKey,
    config.publicKey,
    config.prefix,
    config.hostname,
    config.protocol,
    config.environment,
    config.version,
    config.publishedAt,
    config.gracePeriodDays,
    (config.features ?? []).join('\u0000'),
  ])

  const e = value.enforcement
  return (
    <LicenseContext.Provider value={value}>
      <div data-cyanoff-license={value.state} className={className} style={{ position: 'relative', ...style }}>
        {e?.block ? fallback : children}
        {e?.showWatermark && watermark !== false ? (watermark ?? <Watermark />) : null}
      </div>
    </LicenseContext.Provider>
  )
}

export function useLicense(): LicenseContextValue {
  const v = useContext(LicenseContext)
  if (!v) throw new Error('useLicense must be used inside <LicenseProvider>')
  return v
}

/** True when the named feature is unlocked. Always false while pending. */
export function useFeature(name: string): boolean {
  return useLicense().features.includes(name)
}
