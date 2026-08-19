import { describe, it, expect } from 'vitest'
import { DEFAULT_CATEGORIES, buildClassifier, clusterByCategory } from './classify.js'

describe('buildClassifier with DEFAULT_CATEGORIES', () => {
  const classify = buildClassifier(DEFAULT_CATEGORIES)

  it('classifies an install-error comment', () => {
    expect(classify('npm install fails with a package not found error')).toBe('install')
  })

  it('classifies an environment-setup comment', () => {
    expect(classify('where do I put the API key in my .env file?')).toBe('env')
  })

  it('classifies praise', () => {
    expect(classify('thank you so much, this was so clear!')).toBe('praise')
  })

  it('falls back to the catch-all category when nothing matches', () => {
    expect(classify('what microphone do you use?')).toBe('other')
  })

  it('preserves original precedence: praise wins over a co-occurring install-error keyword', () => {
    // Matches the old hardcoded classify()'s documented behavior — a
    // thank-you that also mentions "error" still lands in praise.
    expect(classify('Thank you! I did hit an error at first but figured it out.')).toBe('praise')
  })

  it('is case-insensitive', () => {
    expect(classify('NPM INSTALL IS FAILING')).toBe('install')
  })
})

describe('buildClassifier with custom creator categories', () => {
  it('respects a creator-supplied ordering and keyword list', () => {
    const categories = [
      { packId: 'pricing', sortOrder: 0, isFallback: false, keywords: ['price', 'cost', 'discount'] },
      { packId: 'other', sortOrder: 1, isFallback: true, keywords: [] },
    ]
    const classify = buildClassifier(categories)
    expect(classify('what does this cost?')).toBe('pricing')
    expect(classify('random comment')).toBe('other')
  })

  it('falls back to the last category when none is flagged isFallback', () => {
    const categories = [
      { packId: 'a', sortOrder: 0, isFallback: false, keywords: ['foo'] },
      { packId: 'b', sortOrder: 1, isFallback: false, keywords: ['bar'] },
    ]
    const classify = buildClassifier(categories)
    expect(classify('neither keyword')).toBe('b')
  })

  it('escapes regex-special characters in keywords', () => {
    const categories = [
      { packId: 'weird', sortOrder: 0, isFallback: false, keywords: ['c++', '3.14'] },
      { packId: 'other', sortOrder: 1, isFallback: true, keywords: [] },
    ]
    const classify = buildClassifier(categories)
    expect(classify('does this work with c++?')).toBe('weird')
    expect(classify('nothing special here')).toBe('other')
  })
})

describe('clusterByCategory', () => {
  const categories = [
    { packId: 'install', label: 'Install error', priority: 'High', tone: 'coral', summary: 's' },
    { packId: 'other', label: 'Needs review', priority: 'Medium', tone: 'amber', summary: 's' },
  ]

  it('groups comments under their category and drops empty ones', () => {
    const comments = [
      { id: 1, packId: 'install', text: 'npm fails' },
      { id: 2, packId: 'install', text: 'still broken' },
    ]
    const clusters = clusterByCategory(categories, comments)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ id: 'install', count: 2 })
  })

  it('carries a per-pack draft from draftByPack', () => {
    const comments = [{ id: 1, packId: 'install', text: 'npm fails' }]
    const drafts = new Map([['install', 'Try Node 18+']])
    const [cluster] = clusterByCategory(categories, comments, drafts)
    expect(cluster.draft).toBe('Try Node 18+')
  })

  it('carries a per-pack context note from contextByPack, defaulting to empty', () => {
    const comments = [
      { id: 1, packId: 'install', text: 'npm fails' },
      { id: 2, packId: 'other', text: 'random' },
    ]
    const contexts = new Map([['install', 'Node 18+ required']])
    const clusters = clusterByCategory(categories, comments, new Map(), contexts)
    expect(clusters.find((cluster) => cluster.id === 'install').context).toBe('Node 18+ required')
    expect(clusters.find((cluster) => cluster.id === 'other').context).toBe('')
  })
})
