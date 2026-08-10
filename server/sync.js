// Resumable, quota-aware channel sync.
//
// The old POST /api/videos/sync walked every video on the channel in one
// synchronous for-loop inside a single HTTP request — fine for a handful of
// videos, but guaranteed to hit a serverless function timeout on a channel
// with hundreds of videos, with no way to resume a partial run. This module
// replaces that with a job (server/db/schema.js: syncJobs) that's advanced
// one bounded chunk at a time, either by the creator re-triggering sync or
// by the cron-driven internal tick route in server/index.js, and that pauses
// itself (status 'paused_quota') instead of blowing through the shared
// YouTube API quota (see server/quota.js).
import crypto from 'node:crypto'
import { eq, and, inArray, desc, sql } from 'drizzle-orm'
import { schema } from './db/index.js'
import { fetchUploadsPlaylistId, fetchAllChannelVideos, fetchVideoCommentCounts, fetchRecentCommentThreads, normalizeThreads } from './youtube.js'
import { computePriorityScore } from './priority.js'
import { checkBudget, recordUsage, UNIT_COSTS } from './quota.js'
import { getCategories, buildClassifier } from './classify.js'

const CHUNK_SIZE = 10 // videos processed per advanceSyncJob() call

async function updateJob(db, id, fields) {
  const [job] = await db.update(schema.syncJobs).set({ ...fields, updatedAt: new Date() })
    .where(eq(schema.syncJobs.id, id)).returning()
  return job
}

// Finds the creator's in-flight job (running or waiting on quota) or starts
// a new one. Only one active job per creator at a time.
export async function getOrCreateJob(db, creatorId) {
  const [existing] = await db.select().from(schema.syncJobs)
    .where(and(eq(schema.syncJobs.creatorId, creatorId), inArray(schema.syncJobs.status, ['running', 'paused_quota'])))
    .orderBy(desc(schema.syncJobs.startedAt)).limit(1)
  if (existing) return existing
  const [job] = await db.insert(schema.syncJobs)
    .values({ id: crypto.randomBytes(12).toString('hex'), creatorId, status: 'running' })
    .returning()
  return job
}

export async function listActiveJobs(db) {
  return db.select().from(schema.syncJobs).where(inArray(schema.syncJobs.status, ['running', 'paused_quota']))
}

async function persistRows(db, videoRows, commentRows, answerPackRows) {
  if (videoRows.length) {
    await db.insert(schema.videos).values(videoRows).onConflictDoUpdate({
      target: schema.videos.id,
      set: {
        title: sql`excluded.title`,
        thumbnailUrl: sql`excluded.thumbnail_url`,
        publishedAt: sql`excluded.published_at`,
        lastSyncedAt: sql`excluded.last_synced_at`,
        priorityScore: sql`excluded.priority_score`,
        commentCount: sql`excluded.comment_count`,
        topPackId: sql`excluded.top_pack_id`,
      },
    })
  }
  if (commentRows.length) {
    await db.insert(schema.comments).values(commentRows).onConflictDoUpdate({
      target: schema.comments.id,
      set: {
        authorName: sql`excluded.author_name`,
        authorInitials: sql`excluded.author_initials`,
        text: sql`excluded.text`,
        likeCount: sql`excluded.like_count`,
        publishedAt: sql`excluded.published_at`,
        packId: sql`excluded.pack_id`,
      },
    })
  }
  if (answerPackRows.length) {
    // Don't clobber a draft the creator already wrote for this pack.
    await db.insert(schema.answerPacks).values(answerPackRows).onConflictDoNothing()
  }
}

// Advances a job by exactly one unit of work: either the one-time channel
// listing phase, or one CHUNK_SIZE-sized batch of per-video comment fetches.
// Safe to call repeatedly — checks the quota ledger before doing paid work
// and pauses (rather than fails) when the budget is tight.
export async function advanceSyncJob(db, job, youtube, classify) {
  if (job.status !== 'running' && job.status !== 'paused_quota') return job

  if (!job.cursor) {
    // Phase 1: list every video on the channel (paginated) + batch comment
    // counts. Cost isn't known exactly until we see how many pages that
    // takes, so gate on a conservative flat estimate up front and record
    // the real cost afterward.
    const budget = await checkBudget(db, job.creatorId, UNIT_COSTS.list * 5)
    if (!budget.allowed) return updateJob(db, job.id, { status: 'paused_quota' })

    const uploadsPlaylistId = await fetchUploadsPlaylistId(youtube, job.creatorId)
    if (!uploadsPlaylistId) return updateJob(db, job.id, { status: 'error', error: "Could not find this channel's uploads playlist." })

    const channelVideos = await fetchAllChannelVideos(youtube, uploadsPlaylistId)
    const commentCounts = await fetchVideoCommentCounts(youtube, channelVideos.map((video) => video.id))
    const pages = Math.max(1, Math.ceil(channelVideos.length / 50))
    await recordUsage(db, job.creatorId, UNIT_COSTS.list * (1 + pages + pages)) // channels.list + playlistItems pages + videos.list batches

    const videos = channelVideos.map((video) => ({ ...video, commentCount: commentCounts.get(video.id) || 0 }))
    return updateJob(db, job.id, { cursor: { videos, index: 0 }, videosTotal: videos.length, status: 'running' })
  }

  // Phase 2: process the next chunk of videos.
  const { videos, index } = job.cursor
  if (index >= videos.length) return updateJob(db, job.id, { status: 'done' })

  const chunk = videos.slice(index, index + CHUNK_SIZE)
  const chunkCost = chunk.filter((video) => video.commentCount > 0).length * UNIT_COSTS.list
  const budget = await checkBudget(db, job.creatorId, chunkCost)
  if (!budget.allowed) return updateJob(db, job.id, { status: 'paused_quota' })

  const videoRows = []
  const commentRows = []
  const answerPackRows = []

  for (const video of chunk) {
    const threads = video.commentCount > 0 ? await fetchRecentCommentThreads(youtube, video.id) : []
    const comments = normalizeThreads(threads).map((comment) => ({ ...comment, packId: classify(comment.text) }))
    const bucketCounts = {}
    for (const comment of comments) bucketCounts[comment.packId] = (bucketCounts[comment.packId] || 0) + 1
    const [topPackId, topCount] = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0] || [null, 0]
    const publishedAt = video.publishedAt ? new Date(video.publishedAt) : null

    videoRows.push({
      id: video.id,
      creatorId: job.creatorId,
      title: video.title,
      thumbnailUrl: video.thumbnailUrl,
      publishedAt,
      lastSyncedAt: new Date(),
      priorityScore: computePriorityScore(bucketCounts, publishedAt, Date.now()),
      commentCount: video.commentCount,
      topPackId: topCount > 0 ? topPackId : null,
    })

    for (const comment of comments) {
      commentRows.push({
        id: comment.id,
        videoId: video.id,
        parentId: comment.parentId,
        authorName: comment.name,
        authorInitials: comment.initials,
        text: comment.text,
        likeCount: comment.likes,
        publishedAt: comment.publishedAt ? new Date(comment.publishedAt) : null,
        packId: comment.packId,
      })
    }
    for (const packId of new Set(comments.map((comment) => comment.packId))) {
      answerPackRows.push({ videoId: video.id, packId, draft: '' })
    }
  }

  await persistRows(db, videoRows, commentRows, answerPackRows)
  if (chunkCost) await recordUsage(db, job.creatorId, chunkCost)

  const newIndex = index + chunk.length
  return updateJob(db, job.id, {
    cursor: { videos, index: newIndex },
    videosProcessed: newIndex,
    status: newIndex >= videos.length ? 'done' : 'running',
  })
}

// Drives a job forward for up to `timeBudgetMs` (default 20s, well under a
// typical function timeout) so small/medium channels finish in the one
// click that triggered them. Large channels naturally stop partway through
// and pick back up on the next click, or via the cron tick.
export async function runSyncBurst(db, creatorId, youtube, { timeBudgetMs = 20000 } = {}) {
  const start = Date.now()
  const classify = buildClassifier(await getCategories(db, creatorId))
  let job = await getOrCreateJob(db, creatorId)
  while (Date.now() - start < timeBudgetMs) {
    const statusBefore = job.status
    if (statusBefore !== 'running' && statusBefore !== 'paused_quota') break
    job = await advanceSyncJob(db, job, youtube, classify)
    if (job.status === 'done' || job.status === 'error') break
    if (job.status === 'paused_quota' && statusBefore === 'paused_quota') break // still over budget, stop retrying this burst
  }
  return job
}

// Advances one job by exactly one chunk — used by the cron tick, which
// iterates every active job and gives each one a turn per invocation.
export async function tickSyncJob(db, job, youtube) {
  const classify = buildClassifier(await getCategories(db, job.creatorId))
  return advanceSyncJob(db, job, youtube, classify)
}
