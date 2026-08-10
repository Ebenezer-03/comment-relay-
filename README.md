# Comment Relay

Comment Relay is a creator-controlled reply desk for a YouTube channel. Once connected, a creator lands on a ranked list of their videos (weighted by comment urgency and recency), picks one, and works a reply desk that groups repeated learner questions into answer packs, drafts a response from creator context, and requires explicit selection before anything can be sent.

## Run locally

```bash
npm install
npm run db:push   # creates/updates tables in Neon Postgres
npm run dev
npm run server
```

The frontend runs at `http://localhost:5173` and the API runs at `http://localhost:8787`.

The frontend still falls back to seeded comments when the API is not configured. To enable live YouTube data, copy `.env.example` to `.env`, create a Google OAuth web client, add `http://localhost:8787/api/oauth2callback` as an authorized redirect URI, and fill in the client credentials. The backend uses `commentThreads.list` for sync and `comments.insert` only for explicitly selected replies.

Data — creators, OAuth sessions, videos, comments, answer packs, sent replies — is persisted in Neon Postgres (provisioned via the Vercel Marketplace; `DATABASE_URL` and friends live in `.env.local`, pulled with `vercel env pull`). A creator's identity is their YouTube channel, so signing in with Google links replies and history to that channel rather than a per-server session that resets on restart.

The API logs every request (method, path, status code, duration) to the console — useful for following the sync/classify/draft flow while developing locally.

## Video list and priority ranking

`POST /api/videos/sync` pulls every video on the connected channel (via the uploads playlist), batch-fetches comment counts, samples recent comment threads per video, classifies them, and upserts videos/comments/answer packs — never clobbering an existing draft. `GET /api/videos` then serves that cached list back sorted by a weighted priority score (`server/priority.js`) combining comment-bucket urgency (install errors weighted above praise, matching the classifier priorities below) with a 14-day recency decay.

Clicking a video from that list opens the reply desk scoped to it (`GET /api/videos/:id`), reading cached, already-classified comments and persisted drafts — no live YouTube call on that path. Edits to a draft are saved with `PUT /api/videos/:id/packs/:packId`.

## How comments are grouped

Once live comments are synced, the backend (`server/index.js`) sorts each one into exactly one answer pack with a plain keyword match on the lowercased comment text — no model call, and no per-video tuning. Checks run in this order, so a comment that matches an earlier rule never reaches a later one (e.g. a thank-you that also mentions "error" still lands in Positive feedback, not Install error):

| Pack | Priority | Trigger words |
| --- | --- | --- |
| Positive feedback | Low | `thank`, `great`, `clear`, `love`, `helped`, `finally` |
| Install error | High | `install`, `npm`, `package`, `node`, `error`, `fail`, `cannot`, `can't`, `not work` |
| Environment setup | Medium | `api key`, `.env`, `environment`, `restart`, `variable` |
| Needs review | Medium | catch-all — anything matching none of the above |

Because the word lists were written for one specific coding tutorial, they won't generalize well to other niches out of the box — a cooking channel or a vlog will likely see most comments land in "Needs review." Treat this as a starting point rather than a general-purpose classifier.

## Known limitations

This is an early prototype. A few things are visibly wired up in the UI but not actually implemented yet:

- **Connected videos** now navigates to a real, ranked multi-video list (see above). **Sent replies** is still an inert nav link — clicking it does nothing.
- **Edit context** (next to "CONTEXT USED" in the composer) is a no-op button. The context field below it is already always editable, so the button doesn't currently do anything extra.
- There's no history of sent replies — once a reply is sent, nothing records what was said, to whom, or when.

None of these block the core flow (sync → group → draft → send), but they're worth knowing about before relying on this for real day-to-day use.
