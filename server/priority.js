// Weighted priority score for ranking a creator's videos.
//
// Combines how urgent the comment mix is (install-error questions matter
// more than praise) with how recent the video is (a blocked viewer on
// yesterday's upload matters more than one on a two-year-old video).
//
// Bucket weights mirror the classifier's own priority labels in
// server/index.js: install=High, env=Medium, other=Medium, praise=Low.
const BUCKET_WEIGHTS = { install: 4, env: 2, other: 1, praise: 0.25 }

// Recency half-life, in days: a video's weight roughly halves every 14 days.
const RECENCY_HALF_LIFE_DAYS = 14

export function recencyMultiplier(publishedAt, now = Date.now()) {
  if (!publishedAt) return 1
  const publishedMs = publishedAt instanceof Date ? publishedAt.getTime() : new Date(publishedAt).getTime()
  if (Number.isNaN(publishedMs)) return 1
  const daysSince = Math.max(0, (now - publishedMs) / 86_400_000)
  return 1 / (1 + daysSince / RECENCY_HALF_LIFE_DAYS)
}

// bucketCounts: { install: n, env: n, other: n, praise: n }
// Returns an integer score (higher = needs attention sooner), suitable for
// sorting and for storing directly in videos.priority_score.
export function computePriorityScore(bucketCounts, publishedAt, now = Date.now()) {
  const rawScore = Object.entries(bucketCounts).reduce((sum, [bucket, count]) => sum + count * (BUCKET_WEIGHTS[bucket] || 0), 0)
  return Math.round(rawScore * recencyMultiplier(publishedAt, now) * 100)
}
