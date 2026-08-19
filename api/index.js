// Vercel serverless entrypoint.
//
// vercel.ts registers a cron against /api/internal/sync/tick and the
// frontend calls /api/* for everything, but the project built as a plain
// Vite site with no function behind it: every API route 404'd in production
// and the cron fired into nothing. This file is that missing function.
//
// An Express app is itself a (req, res) handler, so exporting it is all
// Vercel needs. The rewrite in vercel.ts funnels every /api/* path here
// while preserving the original URL, so Express's own router still sees
// /api/videos, /api/auth/status, and so on.
export { default } from '../server/index.js'
