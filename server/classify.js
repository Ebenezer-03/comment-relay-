// Per-creator, editable comment classification.
//
// Replaces the old hardcoded PACK_DEFINITIONS/classify() keyword lists
// (tuned for one specific "build an MCP server" tutorial) with a categories
// table each creator can edit via GET/POST/PUT/DELETE /api/categories.
// Every new creator is seeded with DEFAULT_CATEGORIES on first sign-in, so
// existing behavior is unchanged until they customize their own.
import { eq, asc } from 'drizzle-orm'
import { schema } from './db/index.js'

// Order matches the original hardcoded classify(): praise is checked first,
// so a thank-you that also mentions "error" still lands in Positive
// feedback rather than Install error, same as before this became editable.
export const DEFAULT_CATEGORIES = [
  { packId: 'praise', label: 'Positive feedback', priority: 'Low', tone: 'green', summary: 'Viewers are celebrating the clear walkthrough.', keywords: ['thank', 'great', 'clear', 'love', 'helped', 'finally'], sortOrder: 0, isFallback: false },
  { packId: 'install', label: 'Install error', priority: 'High', tone: 'coral', summary: 'Viewers are blocked installing the project.', keywords: ['install', 'npm', 'package', 'node', 'error', 'fail', 'cannot', "can't", 'not work'], sortOrder: 1, isFallback: false },
  { packId: 'env', label: 'Environment setup', priority: 'Medium', tone: 'amber', summary: 'The API key / environment setup step needs more context.', keywords: ['api key', '.env', 'environment', 'restart', 'variable'], sortOrder: 2, isFallback: false },
  { packId: 'other', label: 'Needs review', priority: 'Medium', tone: 'amber', summary: 'These comments need a closer look.', keywords: [], sortOrder: 3, isFallback: true },
]

// Idempotent — safe to call on every login. Only inserts categories the
// creator doesn't already have (onConflictDoNothing), so it never clobbers
// edits a creator has already made to their default categories.
export async function seedDefaultCategories(db, creatorId) {
  await db.insert(schema.categories)
    .values(DEFAULT_CATEGORIES.map((category) => ({ creatorId, ...category })))
    .onConflictDoNothing()
}

export async function getCategories(db, creatorId) {
  return db.select().from(schema.categories)
    .where(eq(schema.categories.creatorId, creatorId))
    .orderBy(asc(schema.categories.sortOrder))
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Builds a classifier function from a creator's categories, checked in
// sortOrder so an earlier category always wins ties (e.g. a thank-you that
// also mentions "error" still lands wherever the creator ordered praise).
// Falls back to the category flagged isFallback (or the last category, if
// none is flagged) when nothing matches.
export function buildClassifier(categories) {
  const ordered = [...categories].sort((a, b) => a.sortOrder - b.sortOrder)
  const fallback = ordered.find((category) => category.isFallback) || ordered[ordered.length - 1]
  const rules = ordered
    .filter((category) => !category.isFallback && category.keywords?.length)
    .map((category) => ({ packId: category.packId, pattern: new RegExp(category.keywords.map(escapeRegExp).join('|'), 'i') }))

  return function classify(text) {
    const lower = (text || '').toLowerCase()
    for (const rule of rules) {
      if (rule.pattern.test(lower)) return rule.packId
    }
    return fallback?.packId || 'other'
  }
}

// Groups already-classified comments (each carrying a packId) into UI-ready
// answer-pack clusters, one per category, dropping empty ones. Shared by
// the live ad-hoc lookup (GET /api/comments) and the stored-video read path
// (GET /api/videos/:id) in server/index.js.
export function clusterByCategory(categories, comments, draftByPack = new Map()) {
  return categories.map((category) => {
    const packComments = comments.filter((comment) => comment.packId === category.packId)
    return {
      id: category.packId,
      label: category.label,
      priority: category.priority,
      tone: category.tone,
      summary: category.summary,
      count: packComments.length,
      comments: packComments,
      draft: draftByPack.get(category.packId) || '',
    }
  }).filter((cluster) => cluster.comments.length)
}
