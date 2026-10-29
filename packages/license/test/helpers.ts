import { generateKeyPair, issueLicense, type IssueOptions } from '../src/issuer.js'
import type { LicenseConfig } from '../src/types.js'

export const PREFIX = 'acme-v1'
export const pair = await generateKeyPair()

export const prod = (over: Partial<LicenseConfig> = {}): LicenseConfig => ({
  publicKey: pair.publicKey,
  prefix: PREFIX,
  features: ['collab', 'export'],
  environment: 'production',
  hostname: 'app.acme.com',
  now: () => new Date('2027-06-01T00:00:00Z'),
  ...over,
})

export const issue = (over: Partial<IssueOptions> = {}) =>
  issueLicense({
    privateKeyPem: pair.privateKeyPem,
    prefix: PREFIX,
    hosts: ['app.acme.com'],
    features: ['collab'],
    type: 'annual',
    expires: '2027-12-31',
    ...over,
  })
