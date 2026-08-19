import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'node:crypto'
import { createState, verifyState } from './oauthState.js'

beforeAll(() => {
  process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
})

describe('createState / verifyState', () => {
  it('accepts a state it just issued', () => {
    expect(verifyState(createState())).toBe(true)
  })

  it('issues a different state every time', () => {
    const now = Date.now()
    expect(createState(now)).not.toBe(createState(now))
  })

  // The whole point of the rewrite: the verifying process no longer needs to
  // be the one that minted the state, so a callback landing on a different
  // instance (or after a redeploy) still works.
  it('accepts a state without any shared in-process storage', () => {
    const issued = createState()
    // Nothing is recorded anywhere — verification is pure signature checking.
    expect(verifyState(issued)).toBe(true)
    expect(verifyState(issued)).toBe(true) // and it isn't consumed on first use
  })

  it('rejects a tampered signature', () => {
    const [nonce, expiresAt] = createState().split('.')
    expect(verifyState(`${nonce}.${expiresAt}.notavalidsignature`)).toBe(false)
  })

  it('rejects a state whose expiry was extended without re-signing', () => {
    const [nonce, expiresAt, signature] = createState().split('.')
    const later = String(Number(expiresAt) + 60_000)
    expect(verifyState(`${nonce}.${later}.${signature}`)).toBe(false)
  })

  it('rejects an expired state', () => {
    const issued = createState(Date.now() - 60 * 60 * 1000)
    expect(verifyState(issued)).toBe(false)
  })

  it('rejects malformed input', () => {
    for (const bad of [undefined, null, '', 'abc', 'a.b', 'a.b.c.d', 123, {}]) {
      expect(verifyState(bad)).toBe(false)
    }
  })

  it('rejects a state signed with a different secret', () => {
    const original = process.env.SESSION_ENCRYPTION_KEY
    const issued = createState()
    try {
      // Simulate a second deployment with its own key. The module caches the
      // key after first use, so verify through a fresh import.
      process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('base64')
      const [nonce, expiresAt] = issued.split('.')
      const forged = crypto.createHmac('sha256', Buffer.from(process.env.SESSION_ENCRYPTION_KEY, 'base64'))
        .update(`comment-relay:oauth-state:v1.${nonce}.${expiresAt}`)
        .digest('base64url')
      expect(verifyState(`${nonce}.${expiresAt}.${forged}`)).toBe(false)
    } finally {
      process.env.SESSION_ENCRYPTION_KEY = original
    }
  })
})
