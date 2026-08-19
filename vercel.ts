import { routes, type VercelConfig } from '@vercel/config/v1'

// Deploys two things from one project: the Vite frontend (static) and the
// Express API in server/index.js, wrapped as a single function by
// api/index.js.
//
// The cron drives the resumable video sync (server/sync.js) forward for
// every creator with an active job, even if nobody has the app open — needed
// so a large channel's sync actually finishes instead of only advancing
// while a browser tab happens to be polling it.
//
// Vercel Cron always calls this path with GET and, because CRON_SECRET is
// set as a project env var, automatically attaches
// `Authorization: Bearer $CRON_SECRET` — which server/index.js's
// GET /api/internal/sync/tick checks before doing any work.
export const config: VercelConfig = {
  buildCommand: 'npm run build',
  framework: 'vite',
  rewrites: [
    // Every API path is served by the one Express function. Rewrites run
    // after the filesystem check, so real files (static assets) still win.
    routes.rewrite('/api/(.*)', '/api'),
    // SPA fallback: react-router owns /videos, /sent, /reply-desk/:id, and
    // those paths have no file on disk. Excluding /api keeps the rule above
    // from being shadowed.
    routes.rewrite('/((?!api/).*)', '/index.html'),
  ],
  crons: [
    // Note: minute-level crons require a Pro plan; Hobby is limited to one
    // invocation per day. On Hobby, drop this to a daily schedule and rely
    // on the in-app sync bursts to advance jobs while a creator is active.
    { path: '/api/internal/sync/tick', schedule: '* * * * *' },
  ],
}
