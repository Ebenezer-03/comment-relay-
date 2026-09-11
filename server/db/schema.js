import { pgTable, text, integer, timestamp, boolean, jsonb, primaryKey, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// One row per creator who has connected their Google/YouTube account.
export const creators = pgTable('creators', {
  id: text('id').primaryKey(), // YouTube channel ID — stable, unique per creator
  googleSub: text('google_sub').notNull(), // Google account subject, for login identity
  email: text('email'),
  channelTitle: text('channel_title'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// OAuth session tokens, persisted so a server restart doesn't log creators out.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // opaque session id handed to the browser
  creatorId: text('creator_id').notNull().references(() => creators.id, { onDelete: 'cascade' }),
  // Encrypted envelope ({ iv, tag, data }) produced by server/crypto.js, not raw
  // OAuth tokens — see sessionFor()/oauth2callback in server/index.js.
  tokens: jsonb('tokens').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Sliding 30-day expiry; sessionFor() rejects and deletes rows past this.
  expiresAt: timestamp('expires_at').notNull().default(sql`now() + interval '30 days'`),
}, (table) => [index('sessions_creator_id_idx').on(table.creatorId)])

// A video belonging to a creator's channel, refreshed on-demand.
export const videos = pgTable('videos', {
  id: text('id').primaryKey(), // YouTube video ID
  creatorId: text('creator_id').notNull().references(() => creators.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  publishedAt: timestamp('published_at'),
  lastSyncedAt: timestamp('last_synced_at'),
  priorityScore: integer('priority_score').default(0).notNull(),
  commentCount: integer('comment_count').default(0).notNull(),
  topPackId: text('top_pack_id'), // the answer-pack category driving priority, e.g. 'install'
}, (table) => [index('videos_creator_id_idx').on(table.creatorId)])

// Comments pulled from a video's synced threads.
export const comments = pgTable('comments', {
  id: text('id').primaryKey(), // YouTube comment thread ID
  videoId: text('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
  parentId: text('parent_id').notNull(),
  authorName: text('author_name'),
  authorInitials: text('author_initials'),
  text: text('text').notNull(),
  likeCount: integer('like_count').default(0).notNull(),
  publishedAt: timestamp('published_at'),
  packId: text('pack_id').notNull(), // matches a categories.pack_id for this comment's creator
}, (table) => [index('comments_video_id_idx').on(table.videoId)])

// One answer pack per (video, category) combination, holding the current draft.
export const answerPacks = pgTable('answer_packs', {
  videoId: text('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull(), // matches a categories.pack_id for this video's creator
  draft: text('draft').default('').notNull(),
  // Freeform notes (known fixes, creator voice, video-specific details) used
  // to ground both the human writing a reply and AI draft generation. Was
  // previously local-only React state that reset on reload (main.jsx).
  context: text('context').default('').notNull(),
}, (table) => [primaryKey({ columns: [table.videoId, table.packId] })])

// A record of replies actually sent, so "Sent replies" has real history.
export const sentReplies = pgTable('sent_replies', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
  creatorId: text('creator_id').notNull().references(() => creators.id, { onDelete: 'cascade' }),
  parentIds: jsonb('parent_ids').notNull(), // array of YouTube comment IDs replied to
  text: text('text').notNull(),
  ok: boolean('ok').notNull(),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
}, (table) => [index('sent_replies_creator_id_idx').on(table.creatorId)])

// Per-creator, editable classification categories — replaces the old hardcoded
// PACK_DEFINITIONS/classify() keyword lists. Seeded with 4 defaults (matching
// today's install/env/praise/other behavior) the first time a creator connects,
// so existing behavior doesn't change until they edit their categories.
export const categories = pgTable('categories', {
  creatorId: text('creator_id').notNull().references(() => creators.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull(), // slug, e.g. 'install' — referenced by comments.pack_id
  label: text('label').notNull(),
  priority: text('priority').notNull(), // 'High' | 'Medium' | 'Low'
  tone: text('tone').notNull(), // UI color token, e.g. 'coral' | 'amber' | 'green'
  summary: text('summary').default('').notNull(),
  keywords: jsonb('keywords').notNull(), // string[] of lowercase trigger words/phrases, checked in order
  sortOrder: integer('sort_order').default(0).notNull(),
  // Exactly one category per creator should be the catch-all (today's "other");
  // comments matching no other category's keywords land here.
  isFallback: boolean('is_fallback').default(false).notNull(),
}, (table) => [primaryKey({ columns: [table.creatorId, table.packId] })])

// Daily YouTube Data API quota usage, tracked both per-creator and as a
// '__global__' aggregate row (all creators currently share one Google Cloud
// project/quota pool). server/quota.js reads this to enforce a per-creator
// cap and a shared daily budget so one large sync can't starve everyone else.
export const quotaUsage = pgTable('quota_usage', {
  creatorId: text('creator_id').notNull(), // real creator id, or '__global__' for the shared total
  day: text('day').notNull(), // 'YYYY-MM-DD' in UTC
  unitsUsed: integer('units_used').default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.creatorId, table.day] })])

// A resumable video-sync job. Sync no longer walks an entire channel in one
// request — POST /api/videos/sync (and the cron-driven internal tick) each
// advance one bounded chunk and persist a cursor here, so large channels
// don't hit a function timeout and a failed/quota-paused run can resume.
export const syncJobs = pgTable('sync_jobs', {
  id: text('id').primaryKey(),
  creatorId: text('creator_id').notNull().references(() => creators.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('running'), // 'running' | 'done' | 'error' | 'paused_quota'
  cursor: jsonb('cursor'), // { phase, uploadsPlaylistId, pageToken, videoIds, index, ... } — see server/sync.js
  videosTotal: integer('videos_total').default(0).notNull(),
  videosProcessed: integer('videos_processed').default(0).notNull(),
  error: text('error'),
  // Cooperative lease. Both the creator's own POST /api/videos/sync and the
  // every-minute cron tick advance jobs, and nothing stopped them running at
  // once: two workers would read the same cursor, do the same YouTube calls
  // (double-charging quota), and the slower one's write would move `index`
  // backwards. A worker now claims the job by CAS-ing this column forward
  // and only proceeds if the claim succeeded. See server/sync.js: claimJob.
  lockedUntil: timestamp('locked_until'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [index('sync_jobs_creator_id_status_idx').on(table.creatorId, table.status)])

// Decisions surfaced by the autonomous Strands agent for creator judgment.
// Holds high-urgency questions, novel bug reports, or ambiguity that only
// a human decision should resolve.
export const escalations = pgTable('escalations', {
  id: text('id').primaryKey(),
  videoId: text('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
  creatorId: text('creator_id').notNull().references(() => creators.id, { onDelete: 'cascade' }),
  commentId: text('comment_id').notNull(),
  authorName: text('author_name'),
  commentText: text('comment_text').notNull(),
  urgencyReason: text('urgency_reason').notNull(),
  recommendedAction: text('recommended_action').notNull(),
  status: text('status').default('pending').notNull(), // 'pending' | 'resolved' | 'dismissed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [index('escalations_video_id_idx').on(table.videoId)])

