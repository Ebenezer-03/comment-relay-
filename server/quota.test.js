import { describe, it, expect } from 'vitest'
import { evaluateBudget, todayUTC } from './quota.js'

describe('todayUTC', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(todayUTC(new Date('2026-03-05T23:59:00Z'))).toBe('2026-03-05')
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
