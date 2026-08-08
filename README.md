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
