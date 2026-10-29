# cyanoff license

Offline, signature-based license keys for JavaScript products, in the "free in development, key required in production" style.

- **`@cyanoff/license`**: verifies keys in the browser and in Node 20+ through WebCrypto. No runtime dependencies and no network calls.
- **`@cyanoff/license-react`**: `<LicenseProvider>`, `useLicense()`, `useFeature()` and `<Watermark>`.
- **`@cyanoff/license-cli`**: the `cyanoff-license` command, which generates a signing key and issues, verifies and inspects keys.

## How it works

```
<prefix>/<base64url(JSON payload)>.<base64url(ECDSA P-256 / SHA-256 signature)>
```

- You keep a **private key** and sign a small JSON payload with it.
- Your product ships only the **public key** and checks the signature locally.
- The signature covers `<prefix>/<payload>`. A key issued for one product therefore can't be relabelled for another.

Payload fields (`v: 1`):

| field | meaning |
| --- | --- |
| `id` | license id (order id, UUID, ...) |
| `hosts` | `acme.com` (also matches `www.`), `*.acme.com` (any subdomain and the apex), or `*` |
| `features` | feature names this key unlocks |
| `type` | `annual`, `perpetual` or `evaluation` |
| `exp` | expiry date (`YYYY-MM-DD` means the end of that day, UTC) |
| `iat` | issue time |
| `watermark?` | the key is valid, but attribution must stay visible |
| `maxVersion?` | perpetual only: the highest product version covered |
| `sub?` | licensee label, for display only |

Each check returns one of these states:

| state | when |
| --- | --- |
| `pending` | React only: verification hasn't finished yet |
| `licensed` | valid signature, host matches, not expired |
| `licensed-with-watermark` | the same, but the key has the `watermark` flag |
| `unlicensed` | no key or an invalid key, **in development** |
| `unlicensed-production` | no key, an invalid key or the wrong host, **in production** |
| `expired` | past expiry plus grace (annual), past expiry (evaluation), or a product version newer than a perpetual key covers |

Expiry rules by license type:

- **Annual** keys get a grace period after `exp` (default 30 days). During it, `inGracePeriod: true` is set.
- **Evaluation** keys get no grace period.
- **Perpetual** keys never stop working for product versions that were *published* on or before `exp`. Set `publishedAt` (and optionally `version` together with `maxVersion`) in your config.

**Development detection.** Any of these count as development. You can override detection with `environment: 'development' | 'production'`.

- the page is served over `http:`
- the host is a loopback address (`localhost`, `*.localhost`, `127.x.x.x`, `::1`, `0.0.0.0`)
- `NODE_ENV` is set to something other than `production`

## Quickstart

```bash
# 1. Create a signing key. The private key goes ONLY into the file you name.
npx @cyanoff/license-cli keygen --out acme.private.pem --public-out acme.public.txt
#    → prints the public key, e.g. BJx2...  (embed it in your product)

# 2. Issue a key for a customer
npx @cyanoff/license-cli issue -k acme.private.pem -p acme-v1 \
  -H acme-customer.com -H '*.acme-customer.com' -f collab,export --days 365 --sub "Customer Inc"

# 3. Check it
npx @cyanoff/license-cli verify '<key>' -P acme.public.txt -p acme-v1 -H app.acme-customer.com
npx @cyanoff/license-cli inspect '<key>'
```

### In your product (any framework)

```ts
import { verifyLicense, resolveEnforcement } from '@cyanoff/license'

const result = await verifyLicense(userProvidedKey, {
  publicKey: 'BJx2...',            // from keygen
  prefix: 'acme-v1',
  features: ['collab', 'export'],  // names your product understands
  version: '2.3.0',
  publishedAt: '2026-10-29',       // release date of this build (used by perpetual keys)
  // telemetry: (e) => navigator.sendBeacon('/lic', JSON.stringify(e)),  // opt-in, off by default
})

const { showWatermark, block, features, messages } = resolveEnforcement(result, 'watermark')
```

Built-in policies:

- `watermark` (default): show a badge unless the state is `licensed`.
- `feature-gate`: never show a badge (except for `watermark` keys); only unlock `features`.
- `block`: refuse to run in production when the state is unlicensed or expired.
- `warn`: only produce `messages`.

You can also pass your own `(result) => Enforcement` function. **No policy ever blocks in development.**

### React

```tsx
import { LicenseProvider, useFeature } from '@cyanoff/license-react'

<LicenseProvider config={{ publicKey, prefix: 'acme-v1', features: ['collab'] }} licenseKey={key} policy="watermark">
  <Editor />
</LicenseProvider>

function CollabButton() {
  return useFeature('collab') ? <button>Invite</button> : null
}
```

Other props:

- `fallback`: what to render when the `block` policy blocks.
- `watermark`: a custom node, or `false` to draw your own.
- `onResult`
- `logMessages`

## Honest limits

- The check runs entirely on the client, so a determined user can patch it out. This system does not make that impossible. It makes the license terms clear, keeps honest users compliant, and turns removing the check into a clear license violation. Pair it with a license text like [`LICENSE-TEMPLATE.md`](./LICENSE-TEMPLATE.md).
- Keep the private key out of git (`*.pem` is already in `.gitignore`). If it leaks, generate a new key and change the `prefix`, for example `acme-v2`.
- Telemetry is off unless you pass a callback. If you turn it on, tell your users.

## Development

```bash
npm install
npm run build
npm test          # builds, then runs vitest (core, React, CLI end-to-end)
```

## 한국어 요약

tldraw처럼 "개발 환경에서는 무료, 운영 환경에서는 라이선스 키 필요" 방식을 쓰고 싶은 제품을 위한 오프라인 라이선스 키 도구예요.

- **원리**: 개인 키로 `{id, hosts, features, type, exp}`에 ECDSA P-256 서명을 하고, 제품에는 공개 키만 넣어서 서명을 확인해요. 서버 호출이 없어요.
- **도메인**: `acme.com`(`www.` 포함), `*.acme.com`(하위 도메인 전체), `*`(모든 도메인)을 지원해요.
- **개발 환경**: `http:`, localhost나 127.x 같은 로컬 주소, `NODE_ENV`가 `production`이 아닌 경우예요. 이때는 어떤 정책을 써도 실행을 막지 않아요.
- **만료**:
  - 연간: 30일 유예 기간이 있어요.
  - 평가판: 유예 기간이 없어요.
  - 영구: 만료일 이전에 출시된 버전은 계속 쓸 수 있어요.
- **정책**: 워터마크, 기능 제한, 차단, 경고 중에서 고르거나 직접 함수로 만들 수 있어요.
- **사용 추적**: 콜백을 넘길 때만 켜져요. 기본값은 꺼져 있어요.

빠른 시작:

1. `cyanoff-license keygen --out key.pem`으로 서명 키를 만들어요. 개인 키는 파일에만 저장되고 화면에는 출력되지 않아요.
2. `cyanoff-license issue ...`로 고객용 키를 발급해요.
3. 제품에서는 `verifyLicense()`나 `<LicenseProvider>`로 키를 확인해요.

## License

MIT, for this repository's code. The product license template is a separate document that you adapt for your own product.
