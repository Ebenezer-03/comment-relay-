import type { VercelConfig } from '@vercel/config/v1'

// Drives the resumable video sync (server/sync.js) forward for every
// creator with an active job, even if nobody has the app open — needed so
// a large channel's sync actually finishes instead of only advancing while
// a browser tab happens to be polling it.
//
// Vercel Cron always calls this path with GET and, because CRON_SECRET is
// set as a project env var, automatically attaches
// `Authorization: Bearer $CRON_SECRET` — which server/index.js's
// GET /api/internal/sync/tick checks before doing any work.
//
// NOTE: this assumes the Express app in server/index.js is itself the
// deployed API target for this Vercel project. If the API is hosted
// elsewhere, point the cron (or a platform-native scheduler on that host)
// at that deployment's /api/internal/sync/tick instead.
export const config: VercelConfig = {
  buildCommand: 'npm run build',
  framework: 'vite',
  crons: [
    { path: '/api/internal/sync/tick', schedule: '* * * * *' }, // every minute
  ],
}
