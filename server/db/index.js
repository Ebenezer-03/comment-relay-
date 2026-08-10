import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema.js'

// Lazy init: DATABASE_URL isn't set at module-load time in every environment
// (e.g. before Marketplace provisioning), so don't touch it until first use.
let _db = null

export function getDb() {
  if (!_db) {
    const sql = neon(process.env.DATABASE_URL)
    _db = drizzle(sql, { schema })
  }
  return _db
}

export { schema }
