import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  // A valid 32-byte AES-256 key, base64-encoded — crypto.js reads this
  // lazily on first use, so setting it here (before any test calls
  // encryptJSON/decryptJSON) is sufficient without a real .env file.
  process.env.SESSION_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

describe('encryptJSON / decryptJSON', () => {
  it('round-trips an OAuth-token-shaped object', async () => {
    const { encryptJSON, decryptJSON } = await import('./crypto.js')
    const tokens = { access_token: 'a', refresh_token: 'b', expiry_date: 12345 }
    const envelope = encryptJSON(tokens)
    expect(decryptJSON(envelope)).toEqual(tokens)
  })

  it('produces a different ciphertext each time (random IV)', async () => {
    const { encryptJSON } = await import('./crypto.js')
    const a = encryptJSON({ x: 1 })
    const b = encryptJSON({ x: 1 })
    expect(a.data).not.toBe(b.data)
    expect(a.iv).not.toBe(b.iv)
  })

  it('rejects a tampered envelope (GCM auth tag check)', async () => {
    const { encryptJSON, decryptJSON } = await import('./crypto.js')
    const envelope = encryptJSON({ x: 1 })
    envelope.data = Buffer.from('tampered').toString('base64')
    expect(() => decryptJSON(envelope)).toThrow()
  })

  it('throws a clear error when SESSION_ENCRYPTION_KEY is missing', async () => {
    const original = process.env.SESSION_ENCRYPTION_KEY
    delete process.env.SESSION_ENCRYPTION_KEY
    // Re-import isn't needed — the key is read lazily per call, but the
    // module caches a valid key once loaded, so exercise this via a fresh
    // module instance instead.
    const { encryptJSON } = await import(`./crypto.js?missing-key-test`)
    expect(() => encryptJSON({ x: 1 })).toThrow(/SESSION_ENCRYPTION_KEY/)
    process.env.SESSION_ENCRYPTION_KEY = original
  })
})
