import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Multi-worker pools can exceed available memory in constrained CI/sandbox
    // environments for a project this small — one fork is plenty and avoids
    // the OOM crash multi-worker mode hit here.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
