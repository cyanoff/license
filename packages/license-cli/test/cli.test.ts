import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = resolve(__dirname, '../dist/cli.js')
const dir = mkdtempSync(join(tmpdir(), 'cyanoff-license-'))
const priv = join(dir, 'private.pem')

const cli = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })

describe('cyanoff-license end-to-end', () => {
  let publicKey = ''
  let key = ''

  it('keygen writes the private key to a 0600 file and prints only the public key', () => {
    const r = cli('keygen', '--out', priv, '--public-out', join(dir, 'public.txt'))
    expect(r.status).toBe(0)
    publicKey = r.stdout.trim()
    expect(publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/)
    expect(r.stdout + r.stderr).not.toMatch(/PRIVATE KEY/)
    expect(readFileSync(priv, 'utf8')).toMatch(/BEGIN PRIVATE KEY/)
    expect(statSync(priv).mode & 0o777).toBe(0o600)
    expect(readFileSync(join(dir, 'public.txt'), 'utf8').trim()).toBe(publicKey)
  })

  it('keygen refuses to print or overwrite', () => {
    expect(cli('keygen').status).toBe(1)
    expect(cli('keygen', '--out', priv).status).toBe(1)
  })

  it('pubkey re-derives the same public key', () => {
    expect(cli('pubkey', '--private-key', priv).stdout.trim()).toBe(publicKey)
  })

  it('issue → verify round trip', () => {
    const r = cli('issue', '-k', priv, '-p', 'acme-v1', '-H', 'acme.com', '-H', '*.acme.dev', '-f', 'collab,export', '--expires', '2099-01-01', '--sub', 'Acme Inc')
    expect(r.status).toBe(0)
    key = r.stdout.trim()
    expect(key.startsWith('acme-v1/')).toBe(true)

    const v = cli('verify', key, '--public-key', publicKey, '--prefix', 'acme-v1', '--host', 'app.acme.dev', '--json')
    expect(v.status).toBe(0)
    const res = JSON.parse(v.stdout)
    expect(res.state).toBe('licensed')
    expect(res.payload.features).toEqual(['collab', 'export'])
    expect(res.payload.sub).toBe('Acme Inc')
  })

  it('verify fails for wrong host, wrong key and expiry', () => {
    expect(cli('verify', key, '-P', publicKey, '-p', 'acme-v1', '-H', 'evil.com').status).toBe(1)
    const tampered = key.replace(/\.(.{5})/, '.AAAAA')
    expect(cli('verify', tampered, '-P', publicKey, '-p', 'acme-v1', '-H', 'acme.com').stdout).toMatch(/bad-signature|malformed/)
    expect(cli('verify', key, '-P', publicKey, '-p', 'acme-v1', '-H', 'acme.com', '--now', '2100-01-01').stdout).toMatch(/state:\s+expired/)
  })

  it('perpetual keys honour --published-at', () => {
    const k = cli('issue', '-k', priv, '-p', 'acme-v1', '-H', '*', '-t', 'perpetual', '-e', '2027-12-31').stdout.trim()
    const base = ['verify', k, '-P', join(dir, 'public.txt'), '-p', 'acme-v1', '--now', '2040-01-01']
    expect(cli(...base, '--published-at', '2027-06-01').status).toBe(0)
    expect(cli(...base, '--published-at', '2028-06-01').stdout).toMatch(/version-not-covered/)
  })

  it('inspect decodes and verify reads stdin', () => {
    const i = cli('inspect', key)
    expect(JSON.parse(i.stdout).payload.hosts).toEqual(['acme.com', '*.acme.dev'])
    const out = execFileSync(process.execPath, [CLI, 'verify', '-', '-P', publicKey, '-p', 'acme-v1', '-H', 'acme.com'], { input: key, encoding: 'utf8' })
    expect(out).toMatch(/state:\s+licensed/)
  })

  it('issue --out writes the key to a file', () => {
    const f = join(dir, 'key.txt')
    expect(cli('issue', '-k', priv, '-p', 'acme-v1', '-H', '*', '--days', '30', '--out', f).status).toBe(0)
    expect(existsSync(f)).toBe(true)
  })
})
