import { pgTable, text, integer, timestamp, boolean, jsonb, primaryKey } from 'drizzle-orm/pg-core'

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
  tokens: jsonb('tokens').notNull(), // { access_token, refresh_token, expiry_date, ... }
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

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
})

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
  packId: text('pack_id').notNull(), // 'install' | 'env' | 'praise' | 'other'
})

// One answer pack per (video, category) combination, holding the current draft.
export const answerPacks = pgTable('answer_packs', {
  videoId: text('video_id').notNull().references(() => videos.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull(), // 'install' | 'env' | 'praise' | 'other'
  draft: text('draft').default('').notNull(),
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
})
