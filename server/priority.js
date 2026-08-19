// Weighted priority score for ranking a creator's videos.
//
// Combines how urgent the comment mix is (install-error questions matter
// more than praise) with how recent the video is (a blocked viewer on
// yesterday's upload matters more than one on a two-year-old video).
//
// Weights come from each category's own `priority` field rather than a
// hardcoded pack-id list. Categories became per-creator and editable, so a
// creator who renamed 'install' or added a 'recipe' category used to get
// weight 0 for it — their videos ranked at the bottom forever regardless of
// how urgent the comments actually were.

// Maps a category's stored priority label to a scoring weight. The numbers
// match what the old hardcoded BUCKET_WEIGHTS gave the four default
// categories, so default-category creators score identically to before:
// install=High=4, env=Medium=2, praise=Low=0.25.
export const PRIORITY_WEIGHTS = { High: 4, Medium: 2, Low: 0.25 }

// The catch-all category is "medium priority" by label but shouldn't pull a
// video up as hard as a real, identified problem — unclassified comments are
// as likely to be chit-chat as questions. Matches the old `other: 1`.
export const FALLBACK_WEIGHT = 1

const DEFAULT_WEIGHT = PRIORITY_WEIGHTS.Medium

// Builds the { packId: weight } map computePriorityScore() expects from a
// creator's own categories (server/classify.js: getCategories).
export function weightsFromCategories(categories = []) {
  const weights = {}
  for (const category of categories) {
    weights[category.packId] = category.isFallback
      ? FALLBACK_WEIGHT
      : PRIORITY_WEIGHTS[category.priority] ?? DEFAULT_WEIGHT
  }
  return weights
}

// Recency half-life, in days: a video's weight roughly halves every 14 days.
const RECENCY_HALF_LIFE_DAYS = 14

export function recencyMultiplier(publishedAt, now = Date.now()) {
  if (!publishedAt) return 1
  const publishedMs = publishedAt instanceof Date ? publishedAt.getTime() : new Date(publishedAt).getTime()
  if (Number.isNaN(publishedMs)) return 1
  const daysSince = Math.max(0, (now - publishedMs) / 86_400_000)
  return 1 / (1 + daysSince / RECENCY_HALF_LIFE_DAYS)
}

// bucketCounts: { [packId]: n } — how many of the video's comments landed in
// each of the creator's categories.
// weights: { [packId]: n } from weightsFromCategories(). A packId missing
// from the map (e.g. a comment left over from a since-deleted category)
// scores as Medium rather than 0, so it still surfaces for review.
// Returns an integer score (higher = needs attention sooner), suitable for
// sorting and for storing directly in videos.priority_score.
export function computePriorityScore(bucketCounts, publishedAt, now = Date.now(), weights = {}) {
  const rawScore = Object.entries(bucketCounts)
    .reduce((sum, [packId, count]) => sum + count * (weights[packId] ?? DEFAULT_WEIGHT), 0)
  return Math.round(rawScore * recencyMultiplier(publishedAt, now) * 100)
}
