import { describe, it, expect } from 'vitest'
import { recencyMultiplier, computePriorityScore } from './priority.js'

describe('recencyMultiplier', () => {
  it('returns 1 when there is no publish date', () => {
    expect(recencyMultiplier(null)).toBe(1)
  })

  it('returns 1 for a video published right now', () => {
    const now = Date.now()
    expect(recencyMultiplier(new Date(now), now)).toBeCloseTo(1, 5)
  })

  it('roughly halves at the 14-day half-life', () => {
    const now = Date.now()
    const publishedAt = new Date(now - 14 * 86_400_000)
    expect(recencyMultiplier(publishedAt, now)).toBeCloseTo(0.5, 5)
  })

  it('decreases monotonically as a video ages', () => {
    const now = Date.now()
    const recent = recencyMultiplier(new Date(now - 1 * 86_400_000), now)
    const older = recencyMultiplier(new Date(now - 30 * 86_400_000), now)
    expect(recent).toBeGreaterThan(older)
  })
})

describe('computePriorityScore', () => {
  const now = Date.now()

  it('returns 0 for a video with no comments', () => {
    expect(computePriorityScore({}, new Date(now), now)).toBe(0)
  })

  it('weighs install-error comments above praise for the same count', () => {
    const installScore = computePriorityScore({ install: 5 }, new Date(now), now)
    const praiseScore = computePriorityScore({ praise: 5 }, new Date(now), now)
    expect(installScore).toBeGreaterThan(praiseScore)
  })

  it('ranks a recent video above an older one with identical comments', () => {
    const bucketCounts = { install: 3 }
    const recentScore = computePriorityScore(bucketCounts, new Date(now - 1 * 86_400_000), now)
    const olderScore = computePriorityScore(bucketCounts, new Date(now - 60 * 86_400_000), now)
    expect(recentScore).toBeGreaterThan(olderScore)
  })
})
