// AES-256-GCM helpers for encrypting OAuth tokens at rest.
//
// sessions.tokens used to store the raw Google OAuth token payload
// (access_token, refresh_token, ...) as plain JSONB — anyone with read
// access to the database could use it to post replies as any connected
// creator. These helpers wrap that payload in an encrypted envelope instead;
// only this process, holding SESSION_ENCRYPTION_KEY, can read it back.

import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // recommended IV size for GCM

let _key = null

function getKey() {
  if (_key) return _key
  const raw = process.env.SESSION_ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'SESSION_ENCRYPTION_KEY is not set. Generate one with: ' +
      `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('SESSION_ENCRYPTION_KEY must decode (base64) to exactly 32 bytes for AES-256.')
  }
  _key = key
  return _key
}

// Encrypts a JSON-serializable value into a { iv, tag, data } envelope
// (all base64 strings) suitable for storing directly in a jsonb column.
export function encryptJSON(value) {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') }
}

// Reverses encryptJSON(). Throws if the envelope is malformed or the key
// doesn't match (GCM auth tag check fails on tampering or wrong key).
export function decryptJSON(envelope) {
  if (!envelope || typeof envelope !== 'object' || !envelope.iv || !envelope.tag || !envelope.data) {
    throw new Error('Not a valid encrypted envelope.')
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()])
  return JSON.parse(plaintext.toString('utf8'))
}
