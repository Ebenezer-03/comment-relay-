// Vercel AI Gateway integration — comment reclassification and draft
// generation. Both are explicit, creator-triggered actions (a button click
// from the reply desk), never run automatically during sync, so cost stays
// bounded and predictable the same way YouTube quota is (server/quota.js).
//
// Auth is OIDC by default (VERCEL_OIDC_TOKEN from `vercel env pull`, already
// present in .env.local) — no provider API key needed locally. Model ids are
// plain "provider/model" strings; the `ai` package routes them through the
// gateway automatically, no gateway() wrapper required.
import { generateText, Output } from 'ai'
import { z } from 'zod'

const CLASSIFY_MODEL = 'anthropic/claude-haiku-4.5' // cheap/fast — good enough for a bucket pick
const DRAFT_MODEL = 'anthropic/claude-sonnet-5' // higher quality — this text goes out to real commenters
const CLASSIFY_BATCH_SIZE = 25

function chunk(items, size) {
  const chunks = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// Re-buckets comments into a creator's real categories with an LLM instead
// of the plain keyword classifier (server/classify.js:buildClassifier).
// Keyword matching stays the instant/free default during sync; this is the
// opt-in "Reclassify with AI" action for when keyword rules aren't cutting
// it for a creator's niche (see README's classification limitation).
// Returns a Map<commentId, packId>; comments the model skips keep whatever
// packId they already had (caller's responsibility to merge).
export async function classifyCommentsWithAI(comments, categories) {
  const packIds = categories.map((category) => category.packId)
  if (!packIds.length || !comments.length) return new Map()

  const schema = z.object({ id: z.string(), packId: z.enum(packIds) })
  const categoryContext = categories
    .map((category) => `- ${category.packId}: "${category.label}" — ${category.summary || 'no description'}`)
    .join('\n')

  const results = new Map()
  for (const batch of chunk(comments, CLASSIFY_BATCH_SIZE)) {
    const commentList = batch.map((comment) => `${comment.id}: ${comment.text}`).join('\n---\n')
    const { output } = await generateText({
      model: CLASSIFY_MODEL,
      output: Output.array({ element: schema }),
      prompt: [
        "You are sorting a YouTube creator's comments into their reply categories.",
        `Categories:\n${categoryContext}`,
        `For each comment below, pick the single best-fitting category id. Reply with one entry per comment, using its exact id.`,
        `Comments:\n${commentList}`,
      ].join('\n\n'),
    })
    for (const item of output) results.set(item.id, item.packId)
  }
  return results
}

// Drafts a reply for one answer pack, grounded in a sample of its comments
// plus whatever context the creator saved (known fixes, their voice,
// video-specific details — server/db/schema.js:answerPacks.context). The
// creator always reviews/edits before sending; nothing here auto-replies.
export async function generateDraftWithAI({ videoTitle, categoryLabel, context, comments }) {
  const sample = comments.slice(0, 8).map((comment) => `- ${comment.text}`).join('\n')
  const { text } = await generateText({
    model: DRAFT_MODEL,
    prompt: [
      `You are drafting a single YouTube reply on behalf of a creator, for the video "${videoTitle}".`,
      `These comments were grouped under "${categoryLabel}":\n${sample}`,
      context?.trim() ? `Creator-provided context to use:\n${context.trim()}` : null,
      'Write one reply the creator could send as-is: warm, specific, under 800 characters, no "Hey guys" greeting, speaking directly to the commenters as a group. Reply with only the reply text, nothing else.',
    ].filter(Boolean).join('\n\n'),
  })
  return text.trim()
}
