// Stateless CSRF `state` for the Google OAuth round-trip.
//
// This used to be `const oauthStates = new Set()` in server/index.js: the
// state was minted in memory by whichever process handled /api/auth/google
// and looked up in memory by whichever process handled /api/oauth2callback.
// Those are not the same process on a serverless/Fluid deployment, and not
// even the same *run* of the process after a restart or redeploy — so a
// legitimate login failed with "Invalid OAuth callback." The Set also grew
// forever, since an abandoned login never came back to delete its entry.
//
// A signed, self-describing token fixes both: nothing is stored, so any
// instance can verify a state any other instance minted, and there is
// nothing to leak. The token proves only that *this deployment* issued the
// value recently, which is exactly what the OAuth state parameter is for.
import crypto from 'node:crypto'
import { getSecretKey } from './crypto.js'

// A login that takes longer than this to come back has to be restarted.
// Long enough for a slow consent screen, short enough that a leaked state
// (e.g. from a browser history entry) is useless by the time it's found.
const STATE_TTL_MS = 10 * 60 * 1000

// Domain separation: keeps this HMAC from ever colliding with another use
// of the same secret (see server/crypto.js: getSecretKey).
const HMAC_LABEL = 'comment-relay:oauth-state:v1'

function sign(payload) {
  return crypto.createHmac('sha256', getSecretKey())
    .update(`${HMAC_LABEL}.${payload}`)
    .digest('base64url')
}

// Returns an opaque `<nonce>.<expiresAt>.<hmac>` string to hand to Google as
// the state parameter. The nonce makes every login attempt's state unique
// even within the same millisecond.
export function createState(now = Date.now()) {
  const nonce = crypto.randomBytes(16).toString('base64url')
  const payload = `${nonce}.${now + STATE_TTL_MS}`
  return `${payload}.${sign(payload)}`
}

// True only for a state this deployment signed and that hasn't expired.
// Constant-time comparison so a caller can't probe the secret by timing
// how far into the digest a forged signature got.
export function verifyState(state, now = Date.now()) {
  if (typeof state !== 'string') return false
  const parts = state.split('.')
  if (parts.length !== 3) return false
  const [nonce, expiresAt, signature] = parts

  const expected = sign(`${nonce}.${expiresAt}`)
  const received = Buffer.from(signature)
  const computed = Buffer.from(expected)
  if (received.length !== computed.length) return false
  if (!crypto.timingSafeEqual(received, computed)) return false

  const expiry = Number(expiresAt)
  return Number.isFinite(expiry) && expiry > now
}
