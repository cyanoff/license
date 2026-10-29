/** Compare two `major.minor.patch` versions (pre-release/build suffixes are ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! < pb[i]! ? -1 : 1
  }
  return 0
}

function parse(v: string): [number, number, number] {
  const m = v.trim().replace(/^v/, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) throw new Error(`invalid version: ${v}`)
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)]
}
