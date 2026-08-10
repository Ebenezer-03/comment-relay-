import { eq, and, sql } from 'drizzle-orm'
import { schema } from './db/index.js'

// Daily YouTube Data API quota ledger.
//
// All creators currently authenticate through one shared Google Cloud
// project (one GOOGLE_CLIENT_ID), which means they share one 10,000-unit/day
// quota pool. Without accounting for that, one creator syncing a large
// channel can silently exhaust the quota for everyone else. This module
// tracks usage per-creator and as a '__global__' aggregate in the
// quota_usage table, and exposes a budget check that server/sync.js
// consults before doing further YouTube API work.
//
// Approximate per-call costs, per Google's published YouTube Data API v3
// quota costs (most list/read calls are 1 unit; writes are far more
// expensive). Kept here so every call site charges the same constant.
export const UNIT_COSTS = {
  list: 1, // channels.list, playlistItems.list, videos.list, commentThreads.list
  commentInsert: 50, // comments.insert
}

const GLOBAL_SCOPE = '__global__'

export function todayUTC(now = new Date()) {
  return now.toISOString().slice(0, 10) // 'YYYY-MM-DD'
}

// Pure budget decision, factored out so it's testable without a database.
export function evaluateBudget({ creatorUnits, globalUnits, creatorCap, globalCap, estimatedUnits }) {
  if (globalUnits + estimatedUnits > globalCap) {
    return { allowed: false, reason: 'global_cap', creatorUnits, globalUnits }
  }
  if (creatorUnits + estimatedUnits > creatorCap) {
    return { allowed: false, reason: 'creator_cap', creatorUnits, globalUnits }
  }
  return { allowed: true, creatorUnits, globalUnits }
}

export function quotaCaps() {
  return {
    // Conservative default: leaves headroom under the real 10,000/day cap
    // for other Google Cloud console usage (e.g. manual API Explorer calls).
    globalCap: Number(process.env.DAILY_QUOTA_BUDGET || 8000),
    // No single creator may use more than this share of the shared pool in
    // one day, so a big channel can't starve everyone else's sync.
    creatorCap: Number(process.env.PER_CREATOR_DAILY_QUOTA || 1500),
  }
}

async function upsertUsage(db, creatorId, day, units) {
  await db.insert(schema.quotaUsage).values({ creatorId, day, unitsUsed: units })
    .onConflictDoUpdate({
      target: [schema.quotaUsage.creatorId, schema.quotaUsage.day],
      set: { unitsUsed: sql`${schema.quotaUsage.unitsUsed} + ${units}` },
    })
}

// Records `units` of quota spend against both the creator's row and the
// shared '__global__' aggregate for today (UTC).
export async function recordUsage(db, creatorId, units) {
  if (!units) return
  const day = todayUTC()
  await upsertUsage(db, creatorId, day, units)
  await upsertUsage(db, GLOBAL_SCOPE, day, units)
}

async function unitsUsedToday(db, creatorId) {
  const day = todayUTC()
  const [row] = await db.select().from(schema.quotaUsage)
    .where(and(eq(schema.quotaUsage.creatorId, creatorId), eq(schema.quotaUsage.day, day))).limit(1)
  return row?.unitsUsed || 0
}

// Checks whether `estimatedUnits` more quota can be spent right now without
// breaching either the per-creator or shared-pool daily cap.
export async function checkBudget(db, creatorId, estimatedUnits) {
  const [creatorUnits, globalUnits] = await Promise.all([
    unitsUsedToday(db, creatorId),
    unitsUsedToday(db, GLOBAL_SCOPE),
  ])
  const { creatorCap, globalCap } = quotaCaps()
  return evaluateBudget({ creatorUnits, globalUnits, creatorCap, globalCap, estimatedUnits })
}
