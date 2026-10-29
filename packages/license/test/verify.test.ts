import { describe, expect, it, vi } from 'vitest'
import { verifyLicense, inspectLicense, compareVersions, resolveEnforcement } from '../src/index.js'
import { generateKeyPair, issueLicense, publicKeyFromPrivate } from '../src/issuer.js'
import { base64UrlToBytes, bytesToBase64Url } from '../src/encoding.js'
import { issue, pair, prod, PREFIX } from './helpers.js'

describe('signature', () => {
  it('accepts a freshly issued key', async () => {
    const r = await verifyLicense(await issue(), prod())
    expect(r.state).toBe('licensed')
    expect(r.signatureValid).toBe(true)
    expect(r.problems).toEqual([])
  })

  it('rejects a tampered payload', async () => {
    const key = await issue()
    const [head, sig] = key.split('.')
    const slash = head!.lastIndexOf('/')
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(head!.slice(slash + 1))))
    payload.features = ['collab', 'export']
    const forged = `${PREFIX}/${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}.${sig}`
    const r = await verifyLicense(forged, prod())
    expect(r.state).toBe('unlicensed-production')
    expect(r.problems).toEqual(['bad-signature'])
    expect(r.features).toEqual([])
  })

  it('rejects a tampered signature', async () => {
    const key = await issue()
    const i = key.lastIndexOf('.') + 10
    const flipped = key.slice(0, i) + (key[i] === 'A' ? 'B' : 'A') + key.slice(i + 1)
    expect((await verifyLicense(flipped, prod())).problems).toEqual(['bad-signature'])
    // changing only the unused trailing bits of the last base64 char is a non-canonical encoding → malformed
    const last = key.at(-1) === 'A' ? 'B' : 'A'
    expect((await verifyLicense(key.slice(0, -1) + last, prod())).state).toBe('unlicensed-production')
  })

  it('rejects a key signed by another private key', async () => {
    const other = await generateKeyPair()
    const key = await issueLicense({ privateKeyPem: other.privateKeyPem, prefix: PREFIX, hosts: ['*'], expires: '2030-01-01' })
    expect((await verifyLicense(key, prod())).problems).toEqual(['bad-signature'])
  })

  it('rejects a key re-labelled with a different prefix (prefix is signed)', async () => {
    const key = await issue({ prefix: 'other-v1' })
    expect((await verifyLicense(key, prod())).problems).toEqual(['wrong-prefix'])
    const relabelled = key.replace(/^other-v1\//, `${PREFIX}/`)
    expect((await verifyLicense(relabelled, prod())).problems).toEqual(['bad-signature'])
  })

  it('handles junk input without throwing', async () => {
    for (const junk of ['', '   ', 'nope', 'acme-v1/', 'acme-v1/abc', 'acme-v1/a.b.c', 'acme-v1/!!.??']) {
      const r = await verifyLicense(junk, prod())
      expect(r.state).toBe('unlicensed-production')
    }
    expect((await verifyLicense(null, prod())).problems).toEqual(['no-key'])
  })

  it('rejects an invalid public key gracefully', async () => {
    const r = await verifyLicense(await issue(), prod({ publicKey: 'AAAA' }))
    expect(r.problems).toEqual(['bad-signature'])
  })

  it('derives the public key from the private key', async () => {
    expect(await publicKeyFromPrivate(pair.privateKeyPem)).toBe(pair.publicKey)
  })
})

describe('hosts', () => {
  const cases: [string[], string, boolean][] = [
    [['app.acme.com'], 'app.acme.com', true],
    [['APP.acme.com'], 'app.acme.com:8443', true],
    [['acme.com'], 'www.acme.com', true],
    [['www.acme.com'], 'acme.com', true],
    [['acme.com'], 'evil.com', false],
    [['acme.com'], 'acme.com.evil.com', false],
    [['acme.com'], 'notacme.com', false],
    [['*.acme.com'], 'a.b.acme.com', true],
    [['*.acme.com'], 'acme.com', true],
    [['*.acme.com'], 'evilacme.com', false],
    [['*'], 'anything.example', true],
    [['x.com', 'acme.com'], 'acme.com', true],
  ]
  it.each(cases)('%j vs %s → %s', async (hosts, hostname, ok) => {
    const r = await verifyLicense(await issue({ hosts }), prod({ hostname }))
    expect(r.state).toBe(ok ? 'licensed' : 'unlicensed-production')
    if (!ok) expect(r.problems).toEqual(['host-mismatch'])
  })

  it('unknown hostname (Node) only passes for "*"', async () => {
    expect((await verifyLicense(await issue(), prod({ hostname: undefined }))).problems).toEqual(['host-mismatch'])
    expect((await verifyLicense(await issue({ hosts: ['*'] }), prod({ hostname: undefined }))).state).toBe('licensed')
  })
})

describe('development detection', () => {
  const auto = (over = {}) => prod({ environment: 'auto', ...over })

  it.each([
    ['localhost', 'https:'],
    ['127.0.0.1', 'https:'],
    ['::1', 'https:'],
    ['my.localhost', 'https:'],
    ['example.com', 'http:'],
  ])('%s over %s is development', async (hostname, protocol) => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = await verifyLicense(null, auto({ hostname, protocol }))
    expect(r.isDevelopment).toBe(true)
    expect(r.state).toBe('unlicensed')
    vi.unstubAllEnvs()
  })

  it('https public host with NODE_ENV=production is production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const r = await verifyLicense(null, auto({ hostname: 'example.com', protocol: 'https:' }))
    expect(r.isDevelopment).toBe(false)
    expect(r.state).toBe('unlicensed-production')
    vi.unstubAllEnvs()
  })

  it('NODE_ENV=development is development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    expect((await verifyLicense(null, auto({ hostname: 'example.com', protocol: 'https:' }))).isDevelopment).toBe(true)
    vi.unstubAllEnvs()
  })

  it('explicit environment override wins', async () => {
    expect((await verifyLicense(null, prod({ environment: 'development', hostname: 'acme.com' }))).state).toBe('unlicensed')
  })
})

describe('expiry', () => {
  const at = (iso: string) => prod({ now: () => new Date(iso) })

  it('annual: valid until end of the expiry day', async () => {
    const r = await verifyLicense(await issue(), at('2027-12-31T23:00:00Z'))
    expect(r.state).toBe('licensed')
    expect(r.inGracePeriod).toBe(false)
  })

  it('annual: grace period after expiry (default 30 days)', async () => {
    const r = await verifyLicense(await issue(), at('2028-01-20T00:00:00Z'))
    expect(r.state).toBe('licensed')
    expect(r.inGracePeriod).toBe(true)
    expect(r.features).toEqual(['collab'])
  })

  it('annual: expired after grace', async () => {
    const r = await verifyLicense(await issue(), at('2028-02-01T00:00:00Z'))
    expect(r.state).toBe('expired')
    expect(r.problems).toEqual(['expired'])
    expect(r.features).toEqual([])
  })

  it('annual: custom grace period', async () => {
    const r = await verifyLicense(await issue(), prod({ now: () => new Date('2028-01-05T00:00:00Z'), gracePeriodDays: 3 }))
    expect(r.state).toBe('expired')
  })

  it('evaluation: no grace period', async () => {
    const key = await issue({ type: 'evaluation', expires: '2027-06-10' })
    expect((await verifyLicense(key, at('2027-06-10T12:00:00Z'))).state).toBe('licensed')
    expect((await verifyLicense(key, at('2027-06-11T00:00:01Z'))).state).toBe('expired')
  })
})

describe('perpetual', () => {
  const key = () => issue({ type: 'perpetual', expires: '2027-12-31' })
  const later = () => new Date('2035-01-01T00:00:00Z')

  it('keeps working forever for versions published before expiry', async () => {
    const r = await verifyLicense(await key(), prod({ now: later, publishedAt: '2027-11-01' }))
    expect(r.state).toBe('licensed')
  })

  it('does not cover versions published after expiry', async () => {
    const r = await verifyLicense(await key(), prod({ now: later, publishedAt: '2028-03-01' }))
    expect(r.state).toBe('expired')
    expect(r.problems).toEqual(['version-not-covered'])
  })

  it('respects maxVersion', async () => {
    const k = await issue({ type: 'perpetual', expires: '2027-12-31', maxVersion: '2.4.0' })
    expect((await verifyLicense(k, prod({ now: later, version: '2.4.0' }))).state).toBe('licensed')
    expect((await verifyLicense(k, prod({ now: later, version: '2.3.9' }))).state).toBe('licensed')
    expect((await verifyLicense(k, prod({ now: later, version: '2.5.0' }))).problems).toEqual(['version-not-covered'])
  })

  it('compareVersions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('v1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('2', '2.0.1')).toBe(-1)
    expect(compareVersions('3.0.0-beta.1', '3.0.0')).toBe(0)
  })
})

describe('features & watermark', () => {
  it('only exposes features the product knows', async () => {
    const r = await verifyLicense(await issue({ features: ['collab', 'export', 'nonsense'] }), prod())
    expect(r.features).toEqual(['collab', 'export'])
  })

  it('accepts all features when the product does not declare a list', async () => {
    const r = await verifyLicense(await issue({ features: ['a', 'b'] }), prod({ features: undefined }))
    expect(r.features).toEqual(['a', 'b'])
  })

  it('no features when unlicensed', async () => {
    const r = await verifyLicense(await issue({ hosts: ['other.com'] }), prod())
    expect(r.features).toEqual([])
  })

  it('watermark flag yields licensed-with-watermark', async () => {
    const r = await verifyLicense(await issue({ watermark: true }), prod())
    expect(r.state).toBe('licensed-with-watermark')
    expect(r.features).toEqual(['collab'])
  })

  it('inspect decodes without verifying', async () => {
    const info = inspectLicense(await issue({ sub: 'acme inc' }))
    expect(info?.prefix).toBe(PREFIX)
    expect(info?.payload?.sub).toBe('acme inc')
  })
})

describe('enforcement policies', () => {
  it('block only blocks in production', async () => {
    const prodRes = await verifyLicense(null, prod())
    expect(resolveEnforcement(prodRes, 'block').block).toBe(true)
    const devRes = await verifyLicense(null, prod({ environment: 'development' }))
    const e = resolveEnforcement(devRes, 'block')
    expect(e.block).toBe(false)
    expect(e.showWatermark).toBe(true)
  })

  it('watermark / feature-gate / warn', async () => {
    const lic = await verifyLicense(await issue(), prod())
    const none = await verifyLicense(null, prod())
    expect(resolveEnforcement(lic, 'watermark')).toMatchObject({ showWatermark: false, block: false, features: ['collab'] })
    expect(resolveEnforcement(none, 'watermark')).toMatchObject({ showWatermark: true, block: false, features: [] })
    expect(resolveEnforcement(none, 'feature-gate')).toMatchObject({ showWatermark: false, features: [] })
    const warn = resolveEnforcement(none, 'warn')
    expect(warn).toMatchObject({ showWatermark: false, block: false })
    expect(warn.messages.join(' ')).toMatch(/production/)
  })

  it('custom policies can never block in development', async () => {
    const dev = await verifyLicense(null, prod({ environment: 'development' }))
    const e = resolveEnforcement(dev, () => ({ showWatermark: true, block: true, features: [], messages: [] }))
    expect(e.block).toBe(false)
  })
})

describe('telemetry', () => {
  it('is off unless a callback is given, and never breaks verification', async () => {
    const spy = vi.fn()
    const key = await issue({ id: 'lic_123' })
    await verifyLicense(key, prod({ telemetry: spy }))
    expect(spy).toHaveBeenCalledWith({
      state: 'licensed',
      licenseId: 'lic_123',
      hostname: 'app.acme.com',
      version: null,
      isDevelopment: false,
    })
    const r = await verifyLicense(key, prod({ telemetry: () => { throw new Error('boom') } }))
    expect(r.state).toBe('licensed')
  })
})
