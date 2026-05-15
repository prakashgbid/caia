# `@chiefaia/hmac-auth`

Shared HMAC-SHA256 primitives and timestamped-request signing for CAIA
services.

## Why a separate package

Two CAIA packages independently implemented HMAC-SHA256 + timing-safe
verification:

- `@chiefaia/mentor-event-bus` — signs HTTP requests against the event-bus
  server using a shared secret + replay-window timestamp.
- `@chiefaia/capability-broker` — signs capability tokens with a key
  provider abstraction.

Both repeated the same low-level pattern: `createHmac('sha256', key)…digest()`
plus `timingSafeEqual` comparison. Diverging implementations of a security
primitive is the worst kind of duplication. This package owns the canonical
implementation; consumers import from here.

## Public surface

```ts
// Low-level primitives
hmacSign(secret, data)              // Buffer
hmacSignHex(secret, data)           // hex string
hmacVerify(secret, data, provided)  // boolean (timing-safe)

// Timestamped HTTP request signing (from mentor-event-bus)
signRequest(secret, body, now?)     // { 'x-caia-timestamp', 'x-caia-signature' }
verifyRequest(secret, body, headers, now?, replayWindowMs?)
                                    // VerifyResult ({ ok: true } | { ok: false, reason })

// Header constants
TIMESTAMP_HEADER, SIGNATURE_HEADER

// Replay-window default
DEFAULT_REPLAY_WINDOW_MS            // 5 minutes

// Secret loading (env / file, refuses empty / short secrets)
loadSecret(env?)                    // string
```

## Failure mode

`loadSecret()` and `signRequest({ secret: '' })` both throw — auth is mandatory.
No silent fallback to "no auth." Production deploys must provision a secret at
install time.

## Migration notes

- `@chiefaia/mentor-event-bus` now re-exports the public auth surface from
  this package; existing consumers (`server.ts`, `http-client.ts`, etc.) keep
  importing `signRequest` / `verifyRequest` / `loadSecret` from
  `./auth.js`.
- `@chiefaia/capability-broker`'s `signing.ts` continues to expose
  `signTokenPayload` / `verifyTokenSignature` / `StaticSigningKeyProvider`
  but delegates the HMAC computation and constant-time compare to
  `hmacSign` / `hmacVerify` from this package.
