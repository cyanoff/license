import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { inspectLicense, verifyLicense, type LicenseType } from '@cyanoff/license'
import { generateKeyPair, issueLicense, publicKeyFromPrivate } from '@cyanoff/license/issuer'

export interface IO {
  out: (s: string) => void
  err: (s: string) => void
  stdin: () => Promise<string>
}

const defaultIO: IO = {
  out: (s) => process.stdout.write(s + '\n'),
  err: (s) => process.stderr.write(s + '\n'),
  stdin: async () => {
    const chunks: Buffer[] = []
    for await (const c of process.stdin) chunks.push(c as Buffer)
    return Buffer.concat(chunks).toString('utf8')
  },
}

const HELP = `cyanoff-license — offline license keys (ECDSA P-256)

Usage:
  cyanoff-license keygen --out <private.pem> [--public-out <file>] [--force]
  cyanoff-license pubkey --private-key <private.pem>
  cyanoff-license issue  --private-key <private.pem> --prefix <prefix> --host <host>... (--expires <date> | --days <n>)
                         [--feature <name>]... [--type annual|perpetual|evaluation] [--watermark]
                         [--max-version <semver>] [--id <id>] [--sub <licensee>] [--out <file>]
  cyanoff-license verify <key|-> --public-key <key|file> --prefix <prefix> [--host <host>]
                         [--env production|development] [--version <semver>] [--published-at <date>]
                         [--now <date>] [--json]
  cyanoff-license inspect <key|->

Private keys are only ever written to the file you pass with --out; they are never printed.
`

export async function run(argv: string[], io: IO = defaultIO): Promise<number> {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case 'keygen':
      return keygen(rest, io)
    case 'pubkey':
      return pubkey(rest, io)
    case 'issue':
      return issue(rest, io)
    case 'verify':
      return verify(rest, io)
    case 'inspect':
      return inspect(rest, io)
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      io.out(HELP)
      return cmd === undefined ? 1 : 0
    case '-v':
    case '--version':
      io.out('0.1.0')
      return 0
    default:
      io.err(`unknown command: ${cmd}\n\n${HELP}`)
      return 1
  }
}

function fail(io: IO, msg: string): number {
  io.err(`error: ${msg}`)
  return 1
}

async function keygen(args: string[], io: IO): Promise<number> {
  const { values } = parseArgs({
    args,
    options: { out: { type: 'string', short: 'o' }, 'public-out': { type: 'string' }, force: { type: 'boolean' } },
  })
  if (!values.out) return fail(io, 'keygen needs --out <file> (the private key is never printed)')
  if (existsSync(values.out) && !values.force) return fail(io, `${values.out} already exists (use --force to overwrite)`)
  const pair = await generateKeyPair()
  writeFileSync(values.out, pair.privateKeyPem, { mode: 0o600 })
  chmodSync(values.out, 0o600)
  if (values['public-out']) writeFileSync(values['public-out'], pair.publicKey + '\n')
  io.err(`private key written to ${values.out} (mode 600). Keep it secret and out of git.`)
  io.err('public key (embed this in your product):')
  io.out(pair.publicKey)
  return 0
}

function readPrivateKey(path: string | undefined): string {
  if (!path) throw new Error('--private-key <file> is required')
  return readFileSync(path, 'utf8')
}

async function pubkey(args: string[], io: IO): Promise<number> {
  const { values } = parseArgs({ args, options: { 'private-key': { type: 'string', short: 'k' } } })
  io.out(await publicKeyFromPrivate(readPrivateKey(values['private-key'])))
  return 0
}

const TYPES: LicenseType[] = ['annual', 'perpetual', 'evaluation']

async function issue(args: string[], io: IO): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      'private-key': { type: 'string', short: 'k' },
      prefix: { type: 'string', short: 'p' },
      host: { type: 'string', multiple: true, short: 'H' },
      feature: { type: 'string', multiple: true, short: 'f' },
      type: { type: 'string', short: 't' },
      expires: { type: 'string', short: 'e' },
      days: { type: 'string', short: 'd' },
      watermark: { type: 'boolean' },
      'max-version': { type: 'string' },
      id: { type: 'string' },
      sub: { type: 'string' },
      out: { type: 'string', short: 'o' },
    },
  })
  if (!values.prefix) return fail(io, '--prefix is required')
  if (!values.host?.length) return fail(io, '--host is required (repeatable; use "*" for any host)')
  const type = (values.type ?? 'annual') as LicenseType
  if (!TYPES.includes(type)) return fail(io, `--type must be one of ${TYPES.join(', ')}`)
  let expires = values.expires
  if (!expires && values.days) {
    const n = Number(values.days)
    if (!Number.isFinite(n) || n <= 0) return fail(io, '--days must be a positive number')
    expires = new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  }
  if (!expires) return fail(io, '--expires <YYYY-MM-DD> or --days <n> is required')
  const features = (values.feature ?? []).flatMap((f) => f.split(',')).map((f) => f.trim()).filter(Boolean)
  const key = await issueLicense({
    privateKeyPem: readPrivateKey(values['private-key']),
    prefix: values.prefix,
    hosts: values.host.flatMap((h) => h.split(',')).map((h) => h.trim()).filter(Boolean),
    features,
    type,
    expires,
    watermark: values.watermark,
    maxVersion: values['max-version'],
    id: values.id,
    sub: values.sub,
  })
  if (values.out) {
    writeFileSync(values.out, key + '\n')
    io.err(`license key written to ${values.out}`)
  } else {
    io.out(key)
  }
  return 0
}

async function readKeyArg(arg: string | undefined, io: IO): Promise<string> {
  if (!arg) throw new Error('missing license key argument (pass the key, or "-" to read stdin)')
  return (arg === '-' ? await io.stdin() : arg).trim()
}

function readPublicKey(v: string | undefined): string {
  if (!v) throw new Error('--public-key is required (the key itself or a file containing it)')
  return existsSync(v) ? readFileSync(v, 'utf8').trim() : v.trim()
}

async function verify(args: string[], io: IO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      'public-key': { type: 'string', short: 'P' },
      prefix: { type: 'string', short: 'p' },
      host: { type: 'string', short: 'H' },
      env: { type: 'string' },
      version: { type: 'string' },
      'published-at': { type: 'string' },
      now: { type: 'string' },
      'grace-days': { type: 'string' },
      json: { type: 'boolean' },
    },
  })
  if (!values.prefix) return fail(io, '--prefix is required')
  const env = values.env ?? 'production'
  if (env !== 'production' && env !== 'development') return fail(io, '--env must be production or development')
  const now = values.now ? new Date(values.now) : undefined
  if (now && Number.isNaN(now.getTime())) return fail(io, `invalid --now: ${values.now}`)
  const result = await verifyLicense(await readKeyArg(positionals[0], io), {
    publicKey: readPublicKey(values['public-key']),
    prefix: values.prefix,
    hostname: values.host,
    environment: env,
    version: values.version,
    publishedAt: values['published-at'],
    gracePeriodDays: values['grace-days'] ? Number(values['grace-days']) : undefined,
    now: now ? () => now : undefined,
  })
  if (values.json) {
    io.out(JSON.stringify(result, null, 2))
  } else {
    io.out(`state:      ${result.state}`)
    io.out(`signature:  ${result.signatureValid ? 'valid' : 'INVALID'}`)
    if (result.payload) {
      const p = result.payload
      io.out(`id:         ${p.id}`)
      io.out(`type:       ${p.type}${p.watermark ? ' (watermark)' : ''}`)
      io.out(`hosts:      ${p.hosts.join(', ')}`)
      io.out(`features:   ${p.features.join(', ') || '-'}`)
      io.out(`expires:    ${p.exp}${result.inGracePeriod ? ' (in grace period)' : ''}`)
      if (p.maxVersion) io.out(`maxVersion: ${p.maxVersion}`)
      if (p.sub) io.out(`licensee:   ${p.sub}`)
    }
    if (result.problems.length) io.out(`problems:   ${result.problems.join(', ')}`)
  }
  return result.state === 'licensed' || result.state === 'licensed-with-watermark' ? 0 : 1
}

async function inspect(args: string[], io: IO): Promise<number> {
  const { positionals } = parseArgs({ args, allowPositionals: true, options: {} })
  const info = inspectLicense(await readKeyArg(positionals[0], io))
  if (!info) return fail(io, 'not a license key')
  io.err('note: inspect does NOT verify the signature; use `verify` for that.')
  io.out(JSON.stringify(info, null, 2))
  return info.payload ? 0 : 1
}
