# Comment Relay

Comment Relay is a creator-controlled reply desk for one YouTube video. It groups repeated learner questions into answer packs, drafts a response from creator context, and requires explicit selection before anything can be sent.

## Run locally

```bash
npm install
npm run dev
npm run server
```

The frontend runs at `http://localhost:5173` and the API runs at `http://localhost:8787`.

The frontend still falls back to seeded comments when the API is not configured. To enable live YouTube data, copy `.env.example` to `.env`, create a Google OAuth web client, add `http://localhost:8787/api/oauth2callback` as an authorized redirect URI, and fill in the client credentials. The backend uses `commentThreads.list` for sync and `comments.insert` only for explicitly selected replies.

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

- **Connected videos** and **Sent replies** are inert nav links — clicking them does nothing. Only the Reply desk view exists today; the app also only supports one video at a time despite the sidebar implying multi-video support.
- **Edit context** (next to "CONTEXT USED" in the composer) is a no-op button. The context field below it is already always editable, so the button doesn't currently do anything extra.
- The **"answer packs ready" stat** in the video bar is hardcoded to `2` regardless of how many packs actually exist, unlike the adjacent "questions grouped" count, which is real.
- There's no history of sent replies — once a reply is sent, nothing records what was said, to whom, or when.

None of these block the core flow (sync → group → draft → send), but they're worth knowing about before relying on this for real day-to-day use.
