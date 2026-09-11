import { describe, it, expect } from 'vitest'
import { evaluateBudget, quotaDay } from './quota.js'

describe('quotaDay', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(quotaDay(new Date('2026-03-05T18:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  // Google's quota resets at midnight Pacific, so 23:59 UTC on the 5th is
  // still the afternoon of the 5th in PT -- the same quota day, not the next.
  it('buckets by Pacific Time, not UTC', () => {
    expect(quotaDay(new Date('2026-03-05T23:59:00Z'))).toBe('2026-03-05')
    expect(quotaDay(new Date('2026-03-06T01:00:00Z'))).toBe('2026-03-05')
  })

  it('rolls over at midnight Pacific', () => {
    // 2026-03-06T07:59Z is 23:59 PST on the 5th; 08:01Z is 00:01 on the 6th.
    expect(quotaDay(new Date('2026-03-06T07:59:00Z'))).toBe('2026-03-05')
    expect(quotaDay(new Date('2026-03-06T08:01:00Z'))).toBe('2026-03-06')
  })
})

describe('evaluateBudget', () => {
  const caps = { creatorCap: 1500, globalCap: 8000 }

  it('allows spend comfortably within both caps', () => {
    const result = evaluateBudget({ creatorUnits: 0, globalUnits: 0, estimatedUnits: 10, ...caps })
    expect(result.allowed).toBe(true)
  })

  it('blocks on the per-creator cap even when the global pool has room', () => {
    const result = evaluateBudget({ creatorUnits: 1495, globalUnits: 100, estimatedUnits: 10, ...caps })
    expect(result).toMatchObject({ allowed: false, reason: 'creator_cap' })
  })

  it('blocks on the shared global cap even when the creator has room', () => {
    const result = evaluateBudget({ creatorUnits: 10, globalUnits: 7995, estimatedUnits: 10, ...caps })
    expect(result).toMatchObject({ allowed: false, reason: 'global_cap' })
  })

  it('checks the global cap before the creator cap when both would be breached', () => {
    const result = evaluateBudget({ creatorUnits: 1495, globalUnits: 7995, estimatedUnits: 10, ...caps })
    expect(result.reason).toBe('global_cap')
  })

  it('allows spend that lands exactly on a cap', () => {
    const result = evaluateBudget({ creatorUnits: 1490, globalUnits: 0, estimatedUnits: 10, ...caps })
    expect(result.allowed).toBe(true)
  })
})
