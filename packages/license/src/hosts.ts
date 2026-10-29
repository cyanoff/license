/** Normalise a hostname: lowercase, strip port, brackets and a trailing dot. */
export function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase()
  if (h.startsWith('[')) h = h.slice(1, h.indexOf(']') === -1 ? undefined : h.indexOf(']'))
  else if (h.split(':').length === 2) h = h.split(':')[0]!
  return h.replace(/\.$/, '')
}

const stripWww = (h: string) => (h.startsWith('www.') ? h.slice(4) : h)

/**
 * Does `hostname` match one licensed `pattern`?
 * - `*` matches anything (including an unknown host)
 * - `example.com` matches `example.com` and `www.example.com` (and vice versa)
 * - `*.example.com` matches any subdomain at any depth, and the apex `example.com`
 */
export function hostMatches(pattern: string, hostname: string | null): boolean {
  const p = normalizeHost(pattern)
  if (p === '*') return true
  if (!hostname) return false
  const h = normalizeHost(hostname)
  if (p.startsWith('*.')) {
    const base = p.slice(2)
    return h === base || h.endsWith(`.${base}`)
  }
  return stripWww(p) === stripWww(h)
}

export function anyHostMatches(patterns: readonly string[], hostname: string | null): boolean {
  return patterns.some((p) => hostMatches(p, hostname))
}
