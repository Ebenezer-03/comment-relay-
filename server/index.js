import crypto from 'node:crypto'
import express from 'express'
import { google } from 'googleapis'
import { eq, and, gt, desc, sql } from 'drizzle-orm'
import { getDb, schema } from './db/index.js'
import { normalizeThreads } from './youtube.js'
import { encryptJSON, decryptJSON } from './crypto.js'
import { getCategories, buildClassifier, seedDefaultCategories, clusterByCategory } from './classify.js'
import { runSyncBurst, tickSyncJob, listActiveJobs } from './sync.js'
import { recordUsage, UNIT_COSTS } from './quota.js'

const app = express()
const port = Number(process.env.PORT || 8787)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
const scopes = [
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
]
const oauthStates = new Set()

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
// sessions (sessions.expires_at) are rejected and cleaned up on read.
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
  return { tokens: decryptJSON(row.tokens), creatorId: row.creatorId }
}

// Looks up a creator's most recent non-expired session, for the cron-driven
// sync tick (which has no browser session header of its own to read).
async function latestSessionTokensForCreator(db, creatorId) {
  const [row] = await db.select().from(schema.sessions)
    .where(and(eq(schema.sessions.creatorId, creatorId), gt(schema.sessions.expiresAt, new Date())))
    .orderBy(desc(schema.sessions.createdAt)).limit(1)
  return row ? decryptJSON(row.tokens) : null
}

// Strips a sync job down to what the frontend needs (drops the cursor,
// which can carry the full per-video worklist for large channels).
function publicJob(job) {
  if (!job) return null
  return { status: job.status, videosTotal: job.videosTotal, videosProcessed: job.videosProcessed, error: job.error }
}

app.get('/api/auth/status', async (req, res) => {
  const session = await sessionFor(req)
  res.json({ configured: hasGoogleConfig, connected: Boolean(session) })
})

app.get('/api/auth/google', (req, res) => {
  if (!hasGoogleConfig) return res.status(503).json({ error: 'Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' })
  const state = crypto.randomBytes(24).toString('hex')
  oauthStates.add(state)
  res.redirect(oauthClient().generateAuthUrl({ access_type: 'offline', scope: scopes, state, prompt: 'consent' }))
})

app.get('/api/oauth2callback', async (req, res) => {
  const { code, state } = req.query
  if (!code || !state || !oauthStates.has(state)) return res.status(400).send('Invalid OAuth callback.')
  oauthStates.delete(state)
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
app.get('/api/comments', async (req, res) => {
  const videoId = videoIdFromUrl(req.query.videoId)
  if (!videoId) return res.status(400).json({ error: 'Provide a valid YouTube URL or 11-character video ID.' })
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before syncing live comments.' })
  try {
    const db = getDb()
    const categories = await getCategories(db, session.creatorId)
    const classify = buildClassifier(categories)
    const youtube = google.youtube({ version: 'v3', auth: Object.assign(oauthClient(), { credentials: session.tokens }) })
    const response = await youtube.commentThreads.list({ part: ['snippet', 'replies'], videoId, maxResults: 100, order: 'time', textFormat: 'plainText' })
    await recordUsage(db, session.creatorId, UNIT_COSTS.list)
    const comments = normalizeThreads(response.data.items || []).map((comment) => ({ ...comment, packId: classify(comment.text) }))
    res.json({ videoId, fetched: comments.length, clusters: clusterByCategory(categories, comments) })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'YouTube comment sync failed.' })
  }
})

app.post('/api/replies', async (req, res) => {
  const { videoId, parentIds, text } = req.body || {}
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before sending replies.' })
  if (!videoId || !Array.isArray(parentIds) || !parentIds.length || !text?.trim()) {
    return res.status(400).json({ error: 'Provide a videoId, at least one selected comment, and reply text.' })
  }
  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, videoId)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  try {
    const youtube = google.youtube({ version: 'v3', auth: Object.assign(oauthClient(), { credentials: session.tokens }) })
    const results = []
    for (const parentId of parentIds) {
      try {
        const response = await youtube.comments.insert({ part: ['snippet'], requestBody: { snippet: { parentId, textOriginal: text.trim() } } })
        results.push({ parentId, ok: true, id: response.data.id })
      } catch (error) {
        results.push({ parentId, ok: false, error: error.message })
      }
    }
    await recordUsage(db, session.creatorId, results.length * UNIT_COSTS.commentInsert)
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
  }
})

// Serves the creator's videos from the cache built by /api/videos/sync,
// ranked by priority. Cheap and quota-free — call this on every workspace
// load; call sync explicitly (button/refresh) to pull fresh data.
app.get('/api/videos', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before listing videos.' })
  const db = getDb()
  const rows = await db.select().from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)).orderBy(desc(schema.videos.priorityScore))
  res.json({ videos: rows })
})

// Advances (or starts) the creator's resumable sync job for up to ~20s —
// enough for small/medium channels to finish in this one request. Large
// channels stop partway through and continue on the next click or via the
// cron-driven tick below. See server/sync.js for the chunking/quota logic.
app.post('/api/videos/sync', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before syncing videos.' })
  try {
    const client = oauthClient()
    client.setCredentials(session.tokens)
    const youtube = google.youtube({ version: 'v3', auth: client })
    const db = getDb()

    const job = await runSyncBurst(db, session.creatorId, youtube)
    const rows = await db.select().from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)).orderBy(desc(schema.videos.priorityScore))
    res.json({ job: publicJob(job), videos: rows })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'Video sync failed.' })
  }
})

// Lets the frontend poll sync progress without re-triggering a burst.
app.get('/api/videos/sync/status', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before checking sync status.' })
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
      const tokens = await latestSessionTokensForCreator(db, job.creatorId)
      if (!tokens) {
        results.push({ jobId: job.id, skipped: 'no valid session for this creator' })
        continue
      }
      const client = oauthClient()
      client.setCredentials(tokens)
      const youtube = google.youtube({ version: 'v3', auth: client })
      const updated = await tickSyncJob(db, job, youtube)
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
app.get('/api/videos/:id', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before opening a video.' })
  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, req.params.id)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  const [commentRows, packRows, categories] = await Promise.all([
    db.select().from(schema.comments).where(eq(schema.comments.videoId, video.id)),
    db.select().from(schema.answerPacks).where(eq(schema.answerPacks.videoId, video.id)),
    getCategories(db, session.creatorId),
  ])
  const draftByPack = new Map(packRows.map((row) => [row.packId, row.draft]))
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
  res.json({ video, clusters: clusterByCategory(categories, comments, draftByPack) })
})

// Persists an edited draft for one video's answer pack.
app.put('/api/videos/:id/packs/:packId', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before editing a draft.' })
  const { draft } = req.body || {}
  if (typeof draft !== 'string') return res.status(400).json({ error: 'draft must be a string.' })

  const db = getDb()
  const [video] = await db.select().from(schema.videos).where(eq(schema.videos.id, req.params.id)).limit(1)
  if (!video || video.creatorId !== session.creatorId) return res.status(404).json({ error: 'Video not found.' })

  await db.insert(schema.answerPacks).values({ videoId: req.params.id, packId: req.params.packId, draft })
    .onConflictDoUpdate({ target: [schema.answerPacks.videoId, schema.answerPacks.packId], set: { draft: sql`excluded.draft` } })
  res.json({ ok: true })
})

// Categories drive comment classification (server/classify.js) and are
// per-creator so word lists tuned for one niche don't leak into another's.
app.get('/api/categories', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before viewing categories.' })
  res.json({ categories: await getCategories(getDb(), session.creatorId) })
})

app.post('/api/categories', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before adding a category.' })
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

app.put('/api/categories/:packId', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before editing a category.' })
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

app.delete('/api/categories/:packId', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before deleting a category.' })
  const db = getDb()
  const existing = await getCategories(db, session.creatorId)
  const target = existing.find((category) => category.packId === req.params.packId)
  if (!target) return res.status(404).json({ error: 'Category not found.' })
  if (target.isFallback) return res.status(400).json({ error: 'The catch-all category cannot be deleted.' })
  if (existing.length <= 1) return res.status(400).json({ error: 'At least one category must remain.' })

  await db.delete(schema.categories).where(and(eq(schema.categories.creatorId, session.creatorId), eq(schema.categories.packId, req.params.packId)))
  res.json({ categories: await getCategories(db, session.creatorId) })
})

app.listen(port, () => console.log(`Comment Relay API listening on http://localhost:${port}`))
