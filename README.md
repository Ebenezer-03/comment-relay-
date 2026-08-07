# Comment Relay

Comment Relay is a creator-controlled reply desk for one YouTube video. It groups repeated learner questions into answer packs, drafts a response from creator context, and requires explicit selection before anything can be sent.

## Run locally

```bash
npm install
npm run dev
```

The current slice is a frontend-first demo using seeded comments. The integration seams are deliberately small: replace the seeded clusters with `commentThreads.list`, pass creator context to a bounded triage/drafting service, and connect the explicit send action to `comments.insert`.
