import crypto from 'node:crypto'
import express from 'express'
import { google } from 'googleapis'
import { eq, desc, sql } from 'drizzle-orm'
import { getDb, schema } from './db/index.js'
import { fetchUploadsPlaylistId, fetchAllChannelVideos, fetchVideoCommentCounts, fetchRecentCommentThreads } from './youtube.js'
import { computePriorityScore } from './priority.js'

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
  res.setHeader('Access-Control-Allow-Origin', frontendUrl)
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Relay-Session')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
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

function normalizeThreads(items) {
  return items.map((item, index) => {
    const snippet = item.snippet?.topLevelComment?.snippet || {}
    return {
      id: item.id || `youtube-${index}`,
      parentId: item.snippet?.topLevelComment?.id || item.id,
      name: snippet.authorDisplayName || 'YouTube viewer',
      initials: (snippet.authorDisplayName || 'YT').replace(/[^A-Za-z ]/g, '').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      time: snippet.publishedAt ? new Date(snippet.publishedAt).toLocaleDateString() : 'recently',
      text: snippet.textOriginal || snippet.textDisplay || '',
      likes: snippet.likeCount || 0,
    }
  })
}

function classify(comment) {
  const text = comment.text.toLowerCase()
  if (/thank|great|clear|love|helped|finally/.test(text)) return 'praise'
  if (/install|npm|package|node|error|fail|cannot|can't|not work/.test(text)) return 'install'
  if (/api key|\.env|environment|restart|variable/.test(text)) return 'env'
  return 'other'
}

function clusterComments(comments) {
  const definitions = {
    install: { label: 'Install error', priority: 'High', tone: 'coral', summary: 'Viewers are blocked installing the MCP SDK.' },
    env: { label: 'Environment setup', priority: 'Medium', tone: 'amber', summary: 'The API key setup step needs more context.' },
    praise: { label: 'Positive feedback', priority: 'Low', tone: 'green', summary: 'Viewers are celebrating the clear walkthrough.' },
    other: { label: 'Needs review', priority: 'Medium', tone: 'amber', summary: 'These comments need a closer look.' },
  }
  return Object.entries(definitions).map(([id, definition]) => ({ id, ...definition, count: comments.filter((comment) => classify(comment) === id).length, comments: comments.filter((comment) => classify(comment) === id), draft: '' })).filter((cluster) => cluster.comments.length)
}

// Session lookup now reads from Postgres instead of an in-memory Map, so
// creators stay signed in across server restarts/redeploys.
async function sessionFor(req) {
  const sessionId = req.header('X-Relay-Session')
  if (!sessionId) return null
  const db = getDb()
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).limit(1)
  if (!row) return null
  return { tokens: row.tokens, creatorId: row.creatorId }
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

    const sessionId = crypto.randomBytes(24).toString('hex')
    await db.insert(schema.sessions).values({ id: sessionId, creatorId: channel.id, tokens })

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

app.get('/api/comments', async (req, res) => {
  const videoId = videoIdFromUrl(req.query.videoId)
  if (!videoId) return res.status(400).json({ error: 'Provide a valid YouTube URL or 11-character video ID.' })
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before syncing live comments.' })
  try {
    const youtube = google.youtube({ version: 'v3', auth: Object.assign(oauthClient(), { credentials: session.tokens }) })
    const response = await youtube.commentThreads.list({ part: ['snippet', 'replies'], videoId, maxResults: 100, order: 'time', textFormat: 'plainText' })
    const comments = normalizeThreads(response.data.items || [])
    res.json({ videoId, fetched: comments.length, clusters: clusterComments(comments) })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'YouTube comment sync failed.' })
  }
})

app.post('/api/replies', async (req, res) => {
  const { parentIds, text } = req.body || {}
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before sending replies.' })
  if (!Array.isArray(parentIds) || !parentIds.length || !text?.trim()) return res.status(400).json({ error: 'Select at least one comment and provide reply text.' })
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

// Pulls every video on the creator's channel, samples each video's most
// recent comments to classify and score them, and upserts the results.
// This is the expensive path (one YouTube API call per video with comments)
// so it only runs when the creator explicitly asks for a refresh.
app.post('/api/videos/sync', async (req, res) => {
  const session = await sessionFor(req)
  if (!session) return res.status(401).json({ error: 'Connect a Google account before syncing videos.' })
  try {
    const client = oauthClient()
    client.setCredentials(session.tokens)
    const youtube = google.youtube({ version: 'v3', auth: client })

    const uploadsPlaylistId = await fetchUploadsPlaylistId(youtube, session.creatorId)
    if (!uploadsPlaylistId) return res.status(502).json({ error: "Could not find this channel's uploads playlist." })

    const channelVideos = await fetchAllChannelVideos(youtube, uploadsPlaylistId)
    const commentCounts = await fetchVideoCommentCounts(youtube, channelVideos.map((video) => video.id))

    const now = Date.now()
    const videoRows = []
    const commentRows = []
    const answerPackRows = []

    for (const video of channelVideos) {
      const hasComments = (commentCounts.get(video.id) || 0) > 0
      const threads = hasComments ? await fetchRecentCommentThreads(youtube, video.id) : []
      const comments = normalizeThreads(threads)
      const bucketCounts = { install: 0, env: 0, other: 0, praise: 0 }
      for (const comment of comments) bucketCounts[classify(comment)]++

      const [topPackId, topCount] = Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])[0]
      const publishedAt = video.publishedAt ? new Date(video.publishedAt) : null

      videoRows.push({
        id: video.id,
        creatorId: session.creatorId,
        title: video.title,
        thumbnailUrl: video.thumbnailUrl,
        publishedAt,
        lastSyncedAt: new Date(now),
        priorityScore: computePriorityScore(bucketCounts, publishedAt, now),
        commentCount: commentCounts.get(video.id) || 0,
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
          publishedAt: null, // display-formatted "time" string isn't a real date; skip storing it
          packId: classify(comment),
        })
      }

      for (const packId of new Set(comments.map(classify))) {
        answerPackRows.push({ videoId: video.id, packId, draft: '' })
      }
    }

    const db = getDb()
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
          packId: sql`excluded.pack_id`,
        },
      })
    }
    if (answerPackRows.length) {
      // Don't clobber a draft the creator already wrote for this pack.
      await db.insert(schema.answerPacks).values(answerPackRows).onConflictDoNothing()
    }

    const rows = await db.select().from(schema.videos).where(eq(schema.videos.creatorId, session.creatorId)).orderBy(desc(schema.videos.priorityScore))
    res.json({ videos: rows })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'Video sync failed.' })
  }
})

app.listen(port, () => console.log(`Comment Relay API listening on http://localhost:${port}`))
