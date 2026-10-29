import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { LicenseProvider, useFeature, useLicense } from '../src/index.js'
import { generateKeyPair, issueLicense } from '@cyanoff/license/issuer'
import type { LicenseConfig } from '@cyanoff/license'

const pair = await generateKeyPair()
const config: LicenseConfig = {
  publicKey: pair.publicKey,
  prefix: 'acme-v1',
  features: ['collab'],
  environment: 'production',
  hostname: 'acme.com',
  now: () => new Date('2027-01-01T00:00:00Z'),
}
const key = (over = {}) =>
  issueLicense({ privateKeyPem: pair.privateKeyPem, prefix: 'acme-v1', hosts: ['acme.com'], features: ['collab'], expires: '2027-12-31', ...over })

function Probe() {
  const { state } = useLicense()
  const collab = useFeature('collab')
  return <p data-testid="probe">{`${state}:${collab}`}</p>
}

afterEach(cleanup)
vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('LicenseProvider', () => {
  it('starts pending, then becomes licensed with features and no watermark', async () => {
    render(<LicenseProvider config={config} licenseKey={await key()}><Probe /></LicenseProvider>)
    expect(screen.getByTestId('probe').textContent).toBe('pending:false')
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('licensed:true'))
    expect(document.querySelector('[data-cyanoff-watermark]')).toBeNull()
  })

  it('shows the watermark when unlicensed (default policy)', async () => {
    render(<LicenseProvider config={config}><Probe /></LicenseProvider>)
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('unlicensed-production:false'))
    expect(document.querySelector('[data-cyanoff-watermark]')).not.toBeNull()
  })

  it('block policy renders the fallback in production', async () => {
    render(
      <LicenseProvider config={config} policy="block" fallback={<p>need a key</p>}>
        <p>app</p>
      </LicenseProvider>,
    )
    await screen.findByText('need a key')
    expect(screen.queryByText('app')).toBeNull()
  })

  it('block policy never blocks in development', async () => {
    render(
      <LicenseProvider config={{ ...config, environment: 'development' }} policy="block" fallback={<p>need a key</p>}>
        <Probe />
      </LicenseProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('unlicensed:false'))
    expect(screen.queryByText('need a key')).toBeNull()
  })

  it('licensed-with-watermark keeps features and shows a custom watermark', async () => {
    render(
      <LicenseProvider config={config} licenseKey={await key({ watermark: true })} watermark={<i>made with acme</i>}>
        <Probe />
      </LicenseProvider>,
    )
    await screen.findByText('made with acme')
    expect(screen.getByTestId('probe').textContent).toBe('licensed-with-watermark:true')
  })

  it('useLicense outside a provider throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow(/LicenseProvider/)
  })
})
