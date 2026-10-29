export interface RuntimeInfo {
  hostname: string | null
  protocol: string | null
  nodeEnv: string | undefined
}

export function readRuntime(): RuntimeInfo {
  const g = globalThis as {
    location?: { hostname?: string; protocol?: string }
    process?: { env?: Record<string, string | undefined> }
  }
  let nodeEnv: string | undefined
  try {
    nodeEnv = g.process?.env?.NODE_ENV
  } catch {
    nodeEnv = undefined
  }
  return {
    hostname: g.location?.hostname || null,
    protocol: g.location?.protocol || null,
    nodeEnv,
  }
}

/** Loopback / local-only hostnames. */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '::1' ||
    h === '0.0.0.0' ||
    /^127(\.\d{1,3}){3}$/.test(h)
  )
}

/**
 * Heuristic for "this is a developer machine, not a customer-facing deployment":
 * plain `http:`, a loopback host, or a NODE_ENV that is set to something other than `production`.
 * When NODE_ENV is undefined (e.g. a browser bundle without the define), it is ignored.
 */
export function detectDevelopment(rt: RuntimeInfo): boolean {
  if (rt.protocol === 'http:') return true
  if (rt.hostname && isLocalHost(rt.hostname)) return true
  if (rt.nodeEnv !== undefined && rt.nodeEnv !== 'production') return true
  return false
}
