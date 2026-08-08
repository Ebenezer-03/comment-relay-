import crypto from 'node:crypto'
import express from 'express'
import { google } from 'googleapis'

const app = express()
const port = Number(process.env.PORT || 8787)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173'
const hasGoogleConfig = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
const scopes = ['https://www.googleapis.com/auth/youtube.force-ssl']
const sessions = new Map()
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

function sessionFor(req) {
  return sessions.get(req.header('X-Relay-Session'))
}

app.get('/api/auth/status', (req, res) => {
  res.json({ configured: hasGoogleConfig, connected: Boolean(sessionFor(req)) })
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
    const { tokens } = await oauthClient().getToken(code)
    const sessionId = crypto.randomBytes(24).toString('hex')
    sessions.set(sessionId, tokens)
    res.redirect(`${frontendUrl}/?session=${sessionId}`)
  } catch (error) {
    res.status(502).send(`Google OAuth failed: ${error.message}`)
  }
})

app.post('/api/auth/disconnect', (req, res) => {
  sessions.delete(req.header('X-Relay-Session'))
  res.json({ connected: false })
})

app.get('/api/comments', async (req, res) => {
  const videoId = videoIdFromUrl(req.query.videoId)
  if (!videoId) return res.status(400).json({ error: 'Provide a valid YouTube URL or 11-character video ID.' })
  const tokens = sessionFor(req)
  if (!tokens) return res.status(401).json({ error: 'Connect a Google account before syncing live comments.' })
  try {
    const youtube = google.youtube({ version: 'v3', auth: Object.assign(oauthClient(), { credentials: tokens }) })
    const response = await youtube.commentThreads.list({ part: ['snippet', 'replies'], videoId, maxResults: 100, order: 'time', textFormat: 'plainText' })
    const comments = normalizeThreads(response.data.items || [])
    res.json({ videoId, fetched: comments.length, clusters: clusterComments(comments) })
  } catch (error) {
    res.status(error.code === 403 ? 403 : 502).json({ error: error.message || 'YouTube comment sync failed.' })
  }
})

app.post('/api/replies', async (req, res) => {
  const { parentIds, text } = req.body || {}
  const tokens = sessionFor(req)
  if (!tokens) return res.status(401).json({ error: 'Connect a Google account before sending replies.' })
  if (!Array.isArray(parentIds) || !parentIds.length || !text?.trim()) return res.status(400).json({ error: 'Select at least one comment and provide reply text.' })
  try {
    const youtube = google.youtube({ version: 'v3', auth: Object.assign(oauthClient(), { credentials: tokens }) })
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

app.listen(port, () => console.log(`Comment Relay API listening on http://localhost:${port}`))
