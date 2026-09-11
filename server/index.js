import crypto from 'node:crypto'
import express from 'express'
import { google } from 'googleapis'
import { APICallError } from 'ai'
import { eq, and, gt, desc, sql, inArray } from 'drizzle-orm'
import { getDb, schema } from './db/index.js'
import { normalizeThreads } from './youtube.js'
import { encryptJSON, decryptJSON } from './crypto.js'
import { createState, verifyState } from './oauthState.js'
import { getCategories, buildClassifier, seedDefaultCategories, clusterByCategory } from './classify.js'
import { runSyncBurst, tickSyncJob, listActiveJobs } from './sync.js'
import { checkBudget, recordUsage, UNIT_COSTS } from './quota.js'
import { parsePagination } from './pagination.js'
import { classifyCommentsWithAI, generateDraftWithAI } from './ai.js'
import { computePriorityScore, weightsFromCategories } from './priority.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
const scopes = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
]
app.use(express.json())
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`))
  next()
})
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', frontendUrl)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Session')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI || `${frontendUrl}/api/oauth2callback`)
}

// Caps one reply batch. 25 x 50 units = 1250, just under the default
// per-creator daily cap, so a single click can never drain the shared pool.
const MAX_REPLY_BATCH = 25

// Turns a checkBudget() refusal into copy a creator can act on.
function quotaMessage(budget) {
  return budget.reason === 'creator_cap'
    ? "You've reached your daily YouTube API quota. It resets at midnight Pacific Time."
    : "The shared daily YouTube API quota is exhausted. It resets at midnight Pacific Time."
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// Only re-stamp expires_at once the session has aged a day, so an active
// creator costs one extra write per day rather than one per request.
const SESSION_SLIDE_AFTER_MS = 24 * 60 * 60 * 1000

function videoIdFromUrl(input) {
  if (!input) return null
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input
  try {
    const url = new URL(input)
    if (url.hostname === 'youtu.be') return url.pathname.slice(1)
    return url.searchParams.get('v')
  } catch {
    return null
  }
}

// Session lookup reads from Postgres (not an in-memory Map), so creators
// stay signed in across server restarts/redeploys. Tokens are stored as an
// encrypted envelope (server/crypto.js) and decrypted only here. Expired
// sessions (sessions.expires_at) are rejected and cleaned up on read, and a
// session in active use has its expiry slid forward.
async function sessionFor(req) {
  const sessionId = req.header('X-Relay-Session')
  if (!sessionId) return null
  const db = getDb()
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1)
  if (!row) return null
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
    return null
  }
  // Actually slide the expiry the schema comment always promised. Before
  // this, expires_at was stamped once at sign-in and never moved, so a
  // creator using the app every day was still logged out on day 30.
  const remaining = row.expiresAt ? row.expiresAt.getTime() - Date.now() : 0
  if (remaining < SESSION_TTL_MS - SESSION_SLIDE_AFTER_MS) {
    await db.update(schema.sessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(schema.sessions.id, sessionId))
  }
  return { id: row.id, tokens: decryptJSON(row.tokens), creatorId: row.creatorId }
}

// Builds an OAuth client for a session and — crucially — writes refreshed
// tokens back. googleapis silently refreshes an expired access token using
// the stored refresh_token, but the refreshed credentials only lived in that
// one request's client object: every subsequent request paid another refresh
// round-trip to Google. Persisting them means one refresh per hour, not one
// per request.
function clientForSession(session) {
  const client = oauthClient()
  client.setCredentials(session.tokens)
  client.on('tokens', (fresh) => {
    // Google omits refresh_token on a refresh response — merge so we don't
    // drop the only thing that lets us refresh again.
    const merged = { ...session.tokens, ...fresh }
    getDb().update(schema.sessions).set({ tokens: encryptJSON(merged) })
      .where(eq(schema.sessions.id, session.id))
      .catch((error) => console.error('[session] failed to persist refreshed tokens', error))
  })
  return client
}

// Single construction path for an authenticated YouTube client. Replaces
// three slightly different inline spellings, one of which
// (`Object.assign(oauthClient(), { credentials })`) bypassed setCredentials.
function youtubeForSession(session) {
  return google.youtube({ version: 'v3', auth: clientForSession(session) })
}

// Express middleware wrapping sessionFor() — factored out so the ~15
// authenticated routes below don't each repeat
// `const session = await sessionFor(req); if (!session) return res.status(401)...`.
// Attaches the resolved session to req.session; keeps each route's own
// helpful 401 copy via the message argument.
function requireSession(message) {
  return async (req, res, next) => {
    try {
      const session = await sessionFor(req)
      if (!session) return res.status(401).json({ error: message })
      req.session = session
      next()
    } catch (error) {
      next(error)
    }
  }
}

// Looks up a creator's most recent non-expired session, for the cron-driven
// sync tick (which has no browser session header of its own to read).
// Returns the same { id, tokens, creatorId } shape sessionFor() does, so the
// tick can reuse youtubeForSession() and get refresh-token persistence too.
async function latestSessionForCreator(db, creatorId) {
  const [row] = await db.select().from(schema.sessions)
    .where(and(eq(schema.sessions.creatorId, creatorId), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.createdAt)).limit(1)
  return row ? { id: row.id, tokens: decryptJSON(row.tokens), creatorId } : null
}

// Maps AI Gateway errors (server/ai.js) to a status/message pair per the
// gateway's documented codes — 402 budget exceeded, 429 rate limited —
// otherwise treats it as a generic upstream failure.
function aiErrorStatus(error) {
  if (APICallError.isInstance(error) && (error.statusCode === 402 || error.statusCode === 429)) return error.statusCode
  return 502
}
function aiErrorMessage(error) {
  if (APICallError.isInstance(error) && error.statusCode === 402) return 'AI Gateway budget limit reached. Try again later.'
  if (APICallError.isInstance(error) && error.statusCode === 429) return 'Too many AI requests right now. Try again in a moment.'
  return error.message || 'AI request failed.'
}

// Strips a sync job down to what the frontend needs (drops the cursor,
// which can carry the full per-video worklist for large channels).
function publicJob(job) {
  if (!job) return null
  return { status: job.status, videosTotal: job.videosTotal, videosProcessed: job.videosProcessed, error: job.error }
}

app.get('/api/auth/status', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.json({ configured: hasGoogleConfig, connected: false })
  const [creator] = await getDb().select().from(schema.creators).where(eq(schema.creators.id, session.creatorId)).limit(1)
  res.json({
    configured: hasGoogleConfig,
    connected: true,
    // Real signed-in identity for the sidebar/avatar — previously hardcoded
    // to "Alex Kim" in the frontend regardless of who was actually connected.
    creator: creator ? { channelTitle: creator.channelTitle, email: creator.email } : null,
  })
})

app.get('/api/auth/google', (req, res) => {
  if (!hasGoogleConfig) return res.status(503).json({ error: 'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' })
  // Signed rather than stored — see server/oauthState.js for why an
  // in-memory Set couldn't work across instances or restarts.
  const state = createState()
  res.redirect(oauthClient().generateAuthUrl({ access_type: 'offline', scope: scopes, state, prompt: 'consent' }))
})

app.get('/api/oauth2callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !verifyState(state)) return res.status(400).send('Invalid or expired OAuth callback. Please try connecting again.')
  try {
    const client = oauthClient()
    const { tokens } = await client.getToken(code)
    client.setCredentials(tokens)

    // Identify the creator: use their YouTube channel as the stable identity,
    // and their Google account for email/profile display.
    const [userinfo, channelResponse] = await Promise.all([
      google.oauth2('v2').userinfo.get({ auth: client }),
      google.youtube({ version: 'v3', auth: client }).channels.list({ mine: true, part: ['snippet'] }),
    ])
    const channel = channelResponse.data.items?.[0]
    if (!channel) return res.status(502).send('No YouTube channel found on this Google account.')

    const db = getDb()
    await db.insert(schema.creators).values({
      id: channel.id,
      googleSub: userinfo.data.id,
      email: userinfo.data.email,
      channelTitle: channel.snippet?.title,
    }).onConflictDoUpdate({
      target: schema.creators.id,
      set: { googleSub: userinfo.data.id, email: userinfo.data.email, channelTitle: channel.snippet?.title },
    })
    // Idempotent — only fills in categories this creator doesn't already have.
    await seedDefaultCategories(db, channel.id)

    const sessionId = crypto.randomBytes(24).toString('hex')
    await db.insert(schema.sessions).values({ id: sessionId, creatorId: channel.id, tokens: encryptJSON(tokens) })

    res.redirect(`${frontendUrl}/?session=${sessionId}`)
  } catch (error) {
    res.status(502).send(`Google OAuth failed: ${error.message}`)
  }
})

app.post('/api/auth/disconnect', async (req, res) => {
  const sessionId = req.header('X-Relay-Session')
  if (sessionId) await getDb().delete(schema.sessions).where(eq(schema.sessions.id, sessionId))
  res.json({ connected: false })
})

// Ad-hoc, one-off lookup for a video URL/ID outside the synced workspace
// (doesn't touch videos/comments storage). Classifies against the creator's
// configurable categories, same as the stored-video path below.
app.get('/api/comments', requireSession('Connect a Google account before syncing live comments.'), async (req, res) => {
  const videoId = videoIdFromUrl(req.query.videoId)
  if (!videoId) return res.status(400).json({ error: 'Provide a valid YouTube URL or 11-character video ID.' })
  const session = req.session
  try {
    const db = getDb()
    const budget = await checkBudget(db, session.creatorId, UNIT_COSTS.list)
    if (!budget.allowed) return res.status(429).json({ error: quotaMessage(budget) })
    const categories = await getCategories(db, session.creatorId)
    const classify = buildClassifier(categories)
    const youtube = youtubeForSession(session)
    const response = await youtube.commentThreads.list({ part: ['snippet', 'replies'], videoId, maxResults: 100, order: 'time', textFormat: 'plainText' })
    await recordUsage(db, session.creatorId, UNIT_COSTS.list)
    const comments = normalizeThreads(response.data.items || []).map((comment) => ({ ...comment, packId: classify(comment.text) }))
    res.json({ videoId, fetched: comments.length, clusters: clusterByCategory(categories, comments) })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'YouTube comment sync failed.' })
  }
})

app.post('/api/replies', requireSession('Connect a Google account before sending replies.'), async (req, res) => {
  const { videoId, parentIds, text } = req.body || {}
  const session = req.session
  if (!videoId || !Array.isArray(parentIds) || !parentIds.length || !text?.trim()) {
    return res.status(400).json({ error: 'Provide a videoId, at least one selected comment, and reply text.' })
  }
  // comments.insert is by far the most expensive call the app makes (50
  // units each, versus 1 for every read). parentIds was unbounded, so a
  // single request could spend the entire shared daily pool.
  if (parentIds.length > MAX_REPLY_BATCH) {
    return res.status(400).json({ error: `Reply to at most ${MAX_REPLY_BATCH} comments at a time.` })
  }
  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  // The quota ledger was recorded against but never *checked* here — the
  // one write path in the app, and the only one that could exhaust the pool
  // in a single request, was the one path that skipped the budget gate.
  const budget = await checkBudget(db, session.creatorId, parentIds.length * UNIT_COSTS.commentInsert)
  if (!budget.allowed) return res.status(429).json({ error: quotaMessage(budget) })

  const results = []
  try {
    const youtube = youtubeForSession(session)
    for (const parentId of parentIds) {
      try {
        const response = await youtube.comments.insert({ part: ['snippet'], requestBody: { snippet: { parentId, textOriginal: text.trim() } } })
        results.push({ parentId, ok: true, id: response.data.id })
      } catch (error) {
        results.push({ parentId, ok: false, error: error.message })
      }
    }
    // Real send history — sentReplies existed in the schema but nothing
    // wrote to it before. `ok` reflects whether every selected reply in
    // this batch succeeded.
    await db.insert(schema.sentReplies).values({
      id: crypto.randomBytes(12).toString('hex'),
      videoId,
      creatorId: session.creatorId,
      parentIds,
      text: text.trim(),
      ok: results.every((result) => result.ok),
    })
    res.json({ results })
  } catch (error) {
    res.status(502).json({ error: error.message || 'Reply submission failed.' })
  } finally {
    // Charge for every insert actually attempted, even if the handler threw
    // partway through. Previously an exception skipped recordUsage entirely,
    // so real spend went unaccounted and the ledger drifted below reality.
    if (results.length) {
      await recordUsage(db, session.creatorId, results.length * UNIT_COSTS.commentInsert)
        .catch((error) => console.error('[quota] failed to record reply usage', error))
    }
  }
})

// Serves the creator's videos from the cache built by /api/videos/sync,
// ranked by priority. Cheap and quota-free — call this on every workspace
// load; call sync explicitly (button/refresh) to pull fresh data.
app.get('/api/videos', requireSession('Connect a Google account before listing videos.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const { limit, offset } = parsePagination(req.query)
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId))
      .orderBy(desc(schema.videos.priorityScore)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)::int` }).from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)),
  ])
  res.json({ videos: rows, total: count, limit, offset })
})

// Advances (or starts) the creator's resumable sync job for up to ~20s —
// enough for small/medium channels to finish in this one request. Large
// channels stop partway through and continue on the next click or via the
// cron-driven tick below. See server/sync.js for the chunking/quota logic.
app.post('/api/videos/sync', requireSession('Connect a Google account before syncing videos.'), async (req, res) => {
  const session = req.session
  try {
    const youtube = youtubeForSession(session)
    const db = getDb()

    // claimed:false means the cron tick or another tab is already advancing
    // this job — report its state instead of racing it (server/sync.js).
    const { job, claimed } = await runSyncBurst(db, session.creatorId, youtube)
    const rows = await db.select().from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)).orderBy(desc(schema.videos.priorityScore))
    res.json({ job: publicJob(job), claimed, videos: rows })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'Video sync failed.' })
  }
})

// Lets the frontend poll sync progress without re-triggering a burst.
app.get('/api/videos/sync/status', requireSession('Connect a Google account before checking sync status.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const [job] = await db.select().from(schema.syncJobs)
    .where(eq(schema.syncJobs.creatorId, session.creatorId))
    .orderBy(desc(schema.syncJobs.startedAt)).limit(1)
  res.json({ job: publicJob(job) })
})

// Meant to be called by Vercel Cron (see vercel.ts), not the browser.
// Vercel Cron always issues GET requests. Advances every creator's active
// sync job by one chunk so large channels keep draining even if nobody has
// the app open. Authenticated with CRON_SECRET rather than a creator session.
app.get('/api/internal/sync/tick', async (req, res) => {
  if (!process.env.CRON_SECRET) return res.status(503).json({ error: 'CRON_SECRET is not configured.' })
  if (req.header('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ error: 'Unauthorized.' })

  const db = getDb()
  const jobs = await listActiveJobs(db)
  const results = []
  for (const job of jobs) {
    try {
      const session = await latestSessionForCreator(db, job.creatorId)
      if (!session) {
        results.push({ jobId: job.id, skipped: 'no valid session for this creator' })
        continue
      }
      const updated = await tickSyncJob(db, job, youtubeForSession(session))
      if (!updated) {
        results.push({ jobId: job.id, skipped: 'already claimed by an in-flight sync' })
        continue
      }
      results.push({ jobId: job.id, status: updated.status, videosProcessed: updated.videosProcessed, videosTotal: updated.videosTotal })
    } catch (error) {
      results.push({ jobId: job.id, error: error.message })
    }
  }
  res.json({ processed: results.length, results })
})

// Loads one video's cached, classified comments + persisted drafts — no
// live YouTube call. This is what the reply desk reads when a creator
// clicks into a video from their workspace list.
app.get('/api/videos/:id', requireSession('Connect a Google account before opening a video.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, req.params.id)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  const [commentRows, packRows, categories] = await Promise.all([
    db.select().from(schema.comments).where(eq(schema.comments.videoId, video.id)),
    db.select().from(schema.answerPacks).where(eq(schema.answerPacks.videoId, video.id)),
    getCategories(db, session.creatorId),
  ])
  const draftByPack = new Map(packRows.map((row) => [row.packId, row.draft]))
  const contextByPack = new Map(packRows.map((row) => [row.packId, row.context]))
  const comments = commentRows.map((row) => ({
    id: row.id,
    parentId: row.parentId,
    name: row.authorName,
    initials: row.authorInitials,
    text: row.text,
    likes: row.likeCount,
    time: row.publishedAt ? new Date(row.publishedAt).toLocaleDateString() : 'recently',
    packId: row.packId,
  }))
  res.json({ video, clusters: clusterByCategory(categories, comments, draftByPack, contextByPack) })
})

// Persists an edited draft and/or context note for one video's answer pack.
app.put('/api/videos/:id/packs/:packId', requireSession('Connect a Google account before editing a draft.'), async (req, res) => {
  const session = req.session
  const { draft, context } = req.body || {}
  if (draft !== undefined && typeof draft !== 'string') return res.status(400).json({ error: 'draft must be a string.' })
  if (context !== undefined && typeof context !== 'string') return res.status(400).json({ error: 'context must be a string.' })
  if (draft === undefined && context === undefined) return res.status(400).json({ error: 'Provide draft and/or context.' })

  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, req.params.id)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  const values = { videoId: req.params.id, packId: req.params.packId }
  const set = {}
  if (draft !== undefined) { values.draft = draft; set.draft = sql`excluded.draft` }
  if (context !== undefined) { values.context = context; set.context = sql`excluded.context` }
  await db.insert(schema.answerPacks).values(values)
    .onConflictDoUpdate({ target: [schema.answerPacks.videoId, schema.answerPacks.packId], set })
  res.json({ ok: true })
})

// Re-buckets a video's already-synced comments with an LLM (server/ai.js)
// instead of the plain keyword classifier — an explicit, creator-triggered
// upgrade for niches the default keyword rules don't fit well. Recomputes
// topPackId/priorityScore the same way server/sync.js does after a sync.
app.post('/api/videos/:id/reclassify', requireSession('Connect a Google account before reclassifying comments.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, req.params.id)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  const [commentRows, categories] = await Promise.all([
    db.select().from(schema.comments).where(eq(schema.comments.videoId, video.id)),
    getCategories(db, session.creatorId),
  ])
  if (!commentRows.length) return res.status(400).json({ error: 'This video has no synced comments to reclassify.' })

  try {
    const packIds = await classifyCommentsWithAI(commentRows.map((row) => ({ id: row.id, text: row.text })), categories)
    const changed = commentRows.filter((row) => packIds.has(row.id) && packIds.get(row.id) !== row.packId)
    // One statement, not one per comment. This was a Promise.all over
    // individual UPDATEs, and neon-http sends every statement as its own
    // HTTP round-trip — reclassifying a 100-comment video meant 100 of them.
    if (changed.length) {
      const cases = sql.join(
        changed.map((row) => sql`when ${schema.comments.id} = ${row.id} then ${packIds.get(row.id)}`),
        sql` `,
      )
      await db.update(schema.comments)
        .set({ packId: sql`case ${cases} else ${schema.comments.packId} end` })
        .where(inArray(schema.comments.id, changed.map((row) => row.id)))
    }

    const bucketCounts = {}
    for (const row of commentRows) {
      const packId = packIds.get(row.id) || row.packId
      bucketCounts[packId] = (bucketCounts[packId] || 0) + 1
    }
    const topPackId = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || video.topPackId
    // Weighted by the creator's own category priorities, matching what
    // server/sync.js does — not the old hardcoded default-pack weights.
    const priorityScore = computePriorityScore(bucketCounts, video.publishedAt, Date.now(), weightsFromCategories(categories))
    await db.update(schema.videos).set({ topPackId, priorityScore }).where(eq(schema.videos.id, video.id))

    const [packRows] = await Promise.all([db.select().from(schema.answerPacks).where(eq(schema.answerPacks.videoId, video.id))])
    const draftByPack = new Map(packRows.map((row) => [row.packId, row.draft]))
    const contextByPack = new Map(packRows.map((row) => [row.packId, row.context]))
    const comments = commentRows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      name: row.authorName,
      initials: row.authorInitials,
      text: row.text,
      likes: row.likeCount,
      time: row.publishedAt ? new Date(row.publishedAt).toLocaleDateString() : 'recently',
      packId: packIds.get(row.id) || row.packId,
    }))
    res.json({ clusters: clusterByCategory(categories, comments, draftByPack, contextByPack) })
  } catch (error) {
    res.status(aiErrorStatus(error)).json({ error: aiErrorMessage(error) })
  }
})

// Generates a draft reply for one answer pack via the AI Gateway (server/ai.js),
// grounded in a sample of the pack's comments plus any saved context, and
// saves it — same as if the creator had typed it and blurred the textarea.
// Makes the composer's "AI DRAFT" badge describe something real.
app.post('/api/videos/:id/packs/:packId/draft/generate', requireSession('Connect a Google account before generating a draft.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, req.params.id)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  const [categories, commentRows, [pack]] = await Promise.all([
    getCategories(db, session.creatorId),
    db.select().from(schema.comments).where(and(eq(schema.comments.videoId, video.id), eq(schema.comments.packId, req.params.packId))),
    db.select().from(schema.answerPacks).where(and(eq(schema.answerPacks.videoId, video.id), eq(schema.answerPacks.packId, req.params.packId))),
  ])
  const category = categories.find((item) => item.packId === req.params.packId)
  if (!category) return res.status(404).json({ error: 'Category not found.' })
  if (!commentRows.length) return res.status(400).json({ error: 'This pack has no comments to draft a reply for.' })

  try {
    const draft = await generateDraftWithAI({
      videoTitle: video.title,
      categoryLabel: category.label,
      context: pack?.context || '',
      comments: commentRows,
    })
    await db.insert(schema.answerPacks).values({ videoId: video.id, packId: req.params.packId, draft })
      .onConflictDoUpdate({ target: [schema.answerPacks.videoId, schema.answerPacks.packId], set: { draft: sql`excluded.draft` } })
    res.json({ draft })
  } catch (error) {
    res.status(aiErrorStatus(error)).json({ error: aiErrorMessage(error) })
  }
})

// Categories drive comment classification (server/classify.js) and are
// per-creator so word lists tuned for one niche don't leak into another's.
app.get('/api/categories', requireSession('Connect a Google account before viewing categories.'), async (req, res) => {
  res.json({ categories: await getCategories(getDb(), req.session.creatorId) })
})

// Sent-reply history — server/index.js's POST /api/replies has always
// written here (schema.sentReplies), but until now nothing read it back;
// this is what the previously-inert "Sent replies" nav item now calls.
app.get('/api/sent-replies', requireSession('Connect a Google account before viewing sent replies.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const { limit, offset } = parsePagination(req.query)
  const [rows, [{ count }]] = await Promise.all([
    db.select({
      id: schema.sentReplies.id,
      videoId: schema.sentReplies.videoId,
      parentIds: schema.sentReplies.parentIds,
      text: schema.sentReplies.text,
      ok: schema.sentReplies.ok,
      sentAt: schema.sentReplies.sentAt,
      videoTitle: schema.videos.title,
      videoThumbnailUrl: schema.videos.thumbnailUrl,
    }).from(schema.sentReplies)
      .leftJoin(schema.videos, eq(schema.sentReplies.videoId, schema.videos.id))
      .where(eq(schema.sentReplies.creatorId, session.creatorId))
      .orderBy(desc(schema.sentReplies.sentAt)).limit(limit).offset(offset),
    db.select({ count: sql`count(*)::int` }).from(schema.sentReplies).where(eq(schema.sentReplies.creatorId, session.creatorId)),
  ])
  res.json({ replies: rows, total: count, limit, offset })
})

app.post('/api/categories', requireSession('Connect a Google account before adding a category.'), async (req, res) => {
  const session = req.session
  const { packId, label, priority, tone, summary, keywords } = req.body || {}
  if (!packId || !/^[a-z0-9-]+$/.test(packId)) return res.status(400).json({ error: 'packId must be lowercase letters, numbers, and hyphens.' })
  if (!label?.trim()) return res.status(400).json({ error: 'label is required.' })

  const db = getDb()
  const existing = await getCategories(db, session.creatorId)
  try {
    await db.insert(schema.categories).values({
      creatorId: session.creatorId,
      packId,
      label: label.trim(),
      priority: ['High', 'Medium', 'Low'].includes(priority) ? priority : 'Medium',
      tone: tone || 'amber',
      summary: summary || '',
      keywords: Array.isArray(keywords) ? keywords.map(String) : [],
      sortOrder: existing.length,
      isFallback: false,
    })
  } catch {
    return res.status(409).json({ error: 'A category with that id already exists.' })
  }
  res.status(201).json({ categories: await getCategories(db, session.creatorId) })
})

app.put('/api/categories/:packId', requireSession('Connect a Google account before editing a category.'), async (req, res) => {
  const session = req.session
  const { label, priority, tone, summary, keywords, sortOrder } = req.body || {}
  const set = {}
  if (typeof label === 'string' && label.trim()) set.label = label.trim()
  if (['High', 'Medium', 'Low'].includes(priority)) set.priority = priority
  if (typeof tone === 'string') set.tone = tone
  if (typeof summary === 'string') set.summary = summary
  if (Array.isArray(keywords)) set.keywords = keywords.map(String)
  if (Number.isInteger(sortOrder)) set.sortOrder = sortOrder
  if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to update.' })

  const db = getDb()
  const updated = await db.update(schema.categories).set(set)
    .where(and(eq(schema.categories.creatorId, session.creatorId), eq(schema.categories.packId, req.params.packId)))
    .returning()
  if (!updated.length) return res.status(404).json({ error: 'Category not found.' })
  res.json({ categories: await getCategories(db, session.creatorId) })
})

app.delete('/api/categories/:packId', requireSession('Connect a Google account before deleting a category.'), async (req, res) => {
  const session = req.session
  const db = getDb()
  const existing = await getCategories(db, session.creatorId)
  const target = existing.find((category) => category.packId === req.params.packId)
  if (!target) return res.status(404).json({ error: 'Category not found.' })
  if (target.isFallback) return res.status(400).json({ error: 'The catch-all category cannot be deleted.' })
  if (existing.length <= 1) return res.status(400).json({ error: 'At least one category must remain.' })

  // Move this category's comments to the catch-all before deleting it.
  // comments.pack_id is a loose string reference with no FK, and
  // clusterByCategory() drops any cluster with no matching category — so
  // deleting a category used to make its comments silently disappear from
  // the reply desk with no way to get them back.
  const fallback = existing.find((category) => category.isFallback) || existing.find((category) => category.packId !== target.packId)
  await db.update(schema.comments)
    .set({ packId: fallback.packId })
    .where(and(
      eq(schema.comments.packId, target.packId),
      inArray(
        schema.comments.videoId,
        db.select({ id: schema.videos.id }).from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)),
      ),
    ))

  // Clean up any orphaned answer pack drafts for the deleted category
  await db.delete(schema.answerPacks)
    .where(and(
      eq(schema.answerPacks.packId, target.packId),
      inArray(
        schema.answerPacks.videoId,
        db.select({ id: schema.videos.id }).from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)),
      ),
    ))

  await db.delete(schema.categories).where(and(eq(schema.categories.creatorId, session.creatorId), eq(schema.categories.packId, req.params.packId)))
  res.json({ categories: await getCategories(db, session.creatorId) })
})

app.use((req, res) => res.status(404).json({ error: 'Not found.' }))

// Catches anything a route didn't handle in its own try/catch (Express 5
// forwards async rejections here automatically) so a bug returns the same
// JSON error shape as everything else instead of Express's default HTML page.
// eslint-disable-next-line no-unused-vars
app.use((error, req, res, next) => {
  console.error('[error]', error)
  res.status(500).json({ error: 'Internal server error.' })
})

// On Vercel the app is imported by api/index.js and driven per-request by
// the platform — calling listen() there would bind a port nothing routes to.
// Locally (`npm run server`) this is still a normal long-lived Express
// process, so keep listening when we're not running as a function.
if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Comment Relay API listening on http://localhost:${port}`))
}

export default app
