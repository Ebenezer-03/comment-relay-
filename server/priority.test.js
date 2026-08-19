import { describe, it, expect } from 'vitest'
import { recencyMultiplier, computePriorityScore, weightsFromCategories, PRIORITY_WEIGHTS, FALLBACK_WEIGHT } from './priority.js'
import { DEFAULT_CATEGORIES } from './classify.js'

const DEFAULT_WEIGHTS = weightsFromCategories(DEFAULT_CATEGORIES)

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

describe('weightsFromCategories', () => {
  it('reproduces the previously hardcoded weights for the default categories', () => {
    expect(DEFAULT_WEIGHTS).toEqual({ install: 4, env: 2, other: 1, praise: 0.25 })
  })

  it('weights a creator-added category by its own priority label', () => {
    const weights = weightsFromCategories([
      { packId: 'recipe', priority: 'High', isFallback: false },
      { packId: 'shoutout', priority: 'Low', isFallback: false },
    ])
    expect(weights).toEqual({ recipe: PRIORITY_WEIGHTS.High, shoutout: PRIORITY_WEIGHTS.Low })
  })

  it('gives the catch-all category the fallback weight regardless of its label', () => {
    const weights = weightsFromCategories([{ packId: 'misc', priority: 'High', isFallback: true }])
    expect(weights.misc).toBe(FALLBACK_WEIGHT)
  })

  it('falls back to Medium for an unrecognised priority label', () => {
    const weights = weightsFromCategories([{ packId: 'odd', priority: 'Urgent', isFallback: false }])
    expect(weights.odd).toBe(PRIORITY_WEIGHTS.Medium)
  })
})

describe('computePriorityScore', () => {
  const now = Date.now()

  it('returns 0 for a video with no comments', () => {
    expect(computePriorityScore({}, new Date(now), now, DEFAULT_WEIGHTS)).toBe(0)
  })

  it('weighs install-error comments above praise for the same count', () => {
    const installScore = computePriorityScore({ install: 5 }, new Date(now), now, DEFAULT_WEIGHTS)
    const praiseScore = computePriorityScore({ praise: 5 }, new Date(now), now, DEFAULT_WEIGHTS)
    expect(installScore).toBeGreaterThan(praiseScore)
  })

  it('ranks a recent video above an older one with identical comments', () => {
    const bucketCounts = { install: 3 }
    const recentScore = computePriorityScore(bucketCounts, new Date(now - 1 * 86_400_000), now, DEFAULT_WEIGHTS)
    const olderScore = computePriorityScore(bucketCounts, new Date(now - 60 * 86_400_000), now, DEFAULT_WEIGHTS)
    expect(recentScore).toBeGreaterThan(olderScore)
  })

  // The bug this replaces: a renamed/added category scored 0, so a cooking
  // channel's most urgent videos sorted below its praise-only ones.
  it('scores a creator-renamed high-priority category as highly as a default one', () => {
    const custom = weightsFromCategories([{ packId: 'broken-recipe', priority: 'High', isFallback: false }])
    const customScore = computePriorityScore({ 'broken-recipe': 5 }, new Date(now), now, custom)
    const defaultScore = computePriorityScore({ install: 5 }, new Date(now), now, DEFAULT_WEIGHTS)
    expect(customScore).toBe(defaultScore)
    expect(customScore).toBeGreaterThan(0)
  })

  it('scores an unknown packId as Medium rather than zero', () => {
    const score = computePriorityScore({ 'deleted-category': 4 }, new Date(now), now, DEFAULT_WEIGHTS)
    expect(score).toBeGreaterThan(0)
  })
})
