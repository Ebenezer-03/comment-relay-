// Pure query-param parsing for list endpoints (GET /api/videos,
// GET /api/sent-replies). Factored out — like server/quota.js's
// evaluateBudget — so the clamping rules are testable without a database.
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

export function parsePagination(query = {}, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) {
  const rawLimit = Number.parseInt(query.limit, 10)
  const rawOffset = Number.parseInt(query.offset, 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, maxLimit) : defaultLimit
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0
  return { limit, offset }
}
