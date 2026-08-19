# Comment Relay

Comment Relay is a creator-controlled reply desk for a YouTube channel. Once connected, a creator lands on a ranked list of their videos (weighted by comment urgency and recency), picks one, and works a reply desk that groups repeated learner questions into answer packs, drafts a response from creator context, and requires explicit selection before anything can be sent.

Built for multiple creators to use independently — see [Multi-tenancy and quota](#multi-tenancy-and-quota) for how it keeps one creator's usage from affecting another's.

## Run locally

```bash
npm install
npm run db:push   # first time only — syncs schema to Neon Postgres (see "Database migrations" below)
npm run dev
npm run server
```

The frontend runs at `http://localhost:5173` and the API runs at `http://localhost:8787`.

The frontend still falls back to seeded comments when the API is not configured. To enable live YouTube data, copy `.env.example` to `.env`, fill it in (see below for what each variable is for), create a Google OAuth web client, and add `http://localhost:8787/api/oauth2callback` as an authorized redirect URI. The backend uses `commentThreads.list` for sync and `comments.insert` only for explicitly selected replies.

`npm run server` loads `.env` and `.env.local` itself (via Node's `--env-file-if-exists`) — no separate dotenv step needed.

The frontend is now routed (`react-router-dom`): `/` is the reply desk (auto-opens your top-priority video, or `/reply-desk/:videoId` to deep-link a specific one), `/videos` is the full connected-videos list (paginated), and `/sent` is your sent-reply history. `src/main.jsx` just wires up the router now — the actual screens live in `src/pages/`, shared state in `src/context/AppState.jsx`, and reusable pieces in `src/components/`.

Data — creators, OAuth sessions, videos, comments, answer packs, categories, sync jobs, quota usage, sent replies — is persisted in Neon Postgres (provisioned via the Vercel Marketplace; `DATABASE_URL` and friends live in `.env.local`, pulled with `vercel env pull`). A creator's identity is their YouTube channel, so signing in with Google links replies and history to that channel rather than a per-server session that resets on restart.

The API logs every request (method, path, status code, duration) to the console — useful for following the sync/classify/draft flow while developing locally.

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth app used for every creator (see [Multi-tenancy and quota](#multi-tenancy-and-quota)) |
| `SESSION_ENCRYPTION_KEY` | AES-256 key (base64) encrypting OAuth tokens at rest — generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `CRON_SECRET` | Shared secret Vercel Cron sends when triggering the background sync tick — generate the same way |
| `DAILY_QUOTA_BUDGET` / `PER_CREATOR_DAILY_QUOTA` | YouTube API quota ledger caps — see below |

## AI features (reclassify & draft generation)

Two reply-desk actions call an LLM through the **Vercel AI Gateway** (`server/ai.js`), both explicit and creator-triggered — never automatic, so cost stays as predictable as the YouTube quota ledger above:

- **"Reclassify with AI"** (cluster rail) re-buckets a video's already-synced comments into the creator's real categories with `anthropic/claude-haiku-4.5`, instead of the plain keyword classifier (`server/classify.js`). Keyword matching stays the instant/free default during sync.
- **"AI DRAFT"** (composer) generates a reply for the open answer pack with `anthropic/claude-sonnet-5`, grounded in a sample of its comments plus the pack's saved context note. The creator still reviews, edits, and explicitly selects before anything sends.

Locally, auth is OIDC via `VERCEL_OIDC_TOKEN` (already in `.env.local` from `vercel env pull`) — no separate API key needed. That token expires after ~24h; if the two AI actions start failing with an auth error, re-run `vercel env pull .env.local --yes` and restart `npm run server`. The AI Gateway also needs a **credit card on file** on the Vercel team (even to spend the $5/month free credits) — add one at `vercel.com/[team]/~/ai` if requests come back with a billing error.

## Security

- **Tokens are encrypted at rest.** `sessions.tokens` stores an AES-256-GCM envelope (`server/crypto.js`), not raw OAuth tokens — reading the database no longer hands out standing YouTube-posting credentials.
- **Sessions expire.** Each session carries a 30-day `expiresAt`; `sessionFor()` rejects and deletes expired rows rather than treating a session id as a permanent bearer token.
- Losing or rotating `SESSION_ENCRYPTION_KEY` invalidates every existing session (creators just reconnect).

## Multi-tenancy and quota

All creators currently authenticate through one shared Google Cloud OAuth app, which means they share one YouTube Data API quota pool (10,000 units/day by default). `server/quota.js` tracks daily usage per creator and as a `__global__` aggregate in the `quota_usage` table, and every YouTube API call site (listing videos, fetching comments, posting replies) charges against it. `DAILY_QUOTA_BUDGET` caps the shared pool below Google's real limit (leaving headroom); `PER_CREATOR_DAILY_QUOTA` caps any single creator's share, so one large channel's sync can't starve everyone else's.

If a sync job runs into either cap, it pauses (`status: 'paused_quota'`) instead of failing, and picks back up automatically once the day's usage resets.

## Video sync: resumable and chunked

`POST /api/videos/sync` used to walk every video on a channel in one blocking request — fine for a handful of videos, but guaranteed to hit a serverless function timeout on a channel with hundreds. It's now a resumable job (`sync_jobs` table, driven by `server/sync.js`):

- Each call advances the job for up to ~20 seconds — enough for a small/medium channel to finish in the one click that triggered it.
- A large channel naturally stops partway through; the frontend polls `GET /api/videos/sync/status` and automatically re-triggers the next chunk while a job is `running`.
- **Vercel Cron** hits `GET /api/internal/sync/tick` every minute (see `vercel.ts`), authenticated with `CRON_SECRET`, so large-channel syncs keep draining even if nobody has the app open.
- `GET /api/videos` still serves the cached, already-ranked list — cheap and quota-free, safe to call on every workspace load.

## How comments are grouped

Comments are classified with a plain keyword match on the lowercased text (`server/classify.js`) — no model call. Unlike the original hardcoded version, **categories are per-creator and editable** (`GET/POST/PUT/DELETE /api/categories`, or the "Edit categories" panel in the workspace). Every new creator is seeded with 4 defaults on first sign-in, checked in this order so an earlier category always wins ties (e.g. a thank-you that also mentions "error" still lands in Positive feedback, not Install error):

| Pack | Priority | Trigger words |
| --- | --- | --- |
| Positive feedback | Low | `thank`, `great`, `clear`, `love`, `helped`, `finally` |
| Install error | High | `install`, `npm`, `package`, `node`, `error`, `fail`, `cannot`, `can't`, `not work` |
| Environment setup | Medium | `api key`, `.env`, `environment`, `restart`, `variable` |
| Needs review | Medium | catch-all — anything matching none of the above |

These defaults were written for one specific coding tutorial and won't generalize out of the box — a cooking channel or a vlog will see most comments land in "Needs review" until the creator edits their categories' keywords (or adds new ones) to match their own content.

## Database migrations

Schema changes are tracked as migrations (`server/db/migrations/`) instead of applied ad hoc:

```bash
npm run db:generate   # after editing server/db/schema.js — writes a new migration file
npm run db:migrate     # applies pending migrations
```

`npm run db:push` still works for quick local iteration (and is what an already-`db:push`-managed database should run once to pick up this change's new tables/columns), but `generate`/`migrate` is the path going forward so schema history is versioned and reviewable.

## Known limitations

This started as a foundational-hardening pass on top of an early prototype; the areas below have since been filled in end-to-end:

- **The frontend is now routed and modular** (`react-router-dom`, `src/pages/` + `src/context/AppState.jsx`) instead of one large component.
- **The signed-in identity is real** — the sidebar/avatar reflects the connected creator's channel title, sourced from `GET /api/auth/status`, falling back to a demo persona only when nothing's connected.
- **"Edit context" persists** — the composer's context note is saved per answer-pack (`answerPacks.context`) instead of resetting on reload, and the old no-op button is gone (the field was always directly editable).
- **The connected-videos list is paginated** (`GET /api/videos?limit=&offset=`), with a pager in the UI.
- **"Sent replies" is live** — `GET /api/sent-replies` reads back what `POST /api/replies` has always written, with its own page and pagination.
- **Classification has an AI-assisted upgrade** — see [AI features](#ai-features-reclassify--draft-generation). Keyword matching (`server/classify.js`) is still the instant/free default during sync; "Reclassify with AI" and "AI DRAFT" are explicit, creator-triggered actions through the Vercel AI Gateway.

Still open, deferred to a follow-up:

- **No rate limiting** on any endpoint, and **no CSRF protection** beyond the OAuth `state` check (which itself is in-memory, so it won't survive multiple server instances or a restart mid-login).
- **Per-creator quota isolation is a shared pool, not hard isolation** — see [Multi-tenancy and quota](#multi-tenancy-and-quota). A creator who needs guaranteed throughput would need their own Google Cloud OAuth app (not yet supported).
- **Video priority scoring doesn't weight custom categories** — `server/priority.js`'s `BUCKET_WEIGHTS` is still hardcoded to the 4 default category ids (`install`/`env`/`other`/`praise`); a creator who renames or adds categories gets weight `0` for anything outside that set until this is wired to each category's own `priority` field.

None of these block the core flow (sync → group → draft → send), but they're worth knowing about before relying on this for real day-to-day use across many creators.
