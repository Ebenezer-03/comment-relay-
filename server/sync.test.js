import { describe, it, expect } from 'vitest'
import { advanceSyncJob } from './sync.js'
import { DEFAULT_CATEGORIES } from './classify.js'
import { weightsFromCategories } from './priority.js'

// Minimal stand-in for the drizzle query builder. Only the chains
// advanceSyncJob() actually uses are implemented; each terminal call records
// what it was asked to do so a test can assert on it. This is enough to pin
// down the sync job's state machine without a live Postgres.
function fakeDb({ videos = [], quotaUnits = 0 } = {}) {
  const calls = { updates: [], inserts: [] }
  const thenable = (rows) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      limit: () => chain,
      orderBy: () => chain,
      then: (resolve, reject) => Promise.resolve(rows).then(resolve, reject),
    }
    return chain
  }
  return {
    calls,
    select: (fields) => {
      // unitsUsedToday() selects the whole quota row; everything else here
      // is the phase-2 lookup of the chunk's videos.
      if (fields === undefined) return thenable([{ unitsUsed: quotaUnits }])
      return thenable(videos)
    },
    insert: (table) => ({
      values: (rows) => {
        const record = { table, rows: Array.isArray(rows) ? rows : [rows] }
        calls.inserts.push(record)
        const done = {
          onConflictDoUpdate: () => done,
          onConflictDoNothing: () => done,
          then: (resolve, reject) => Promise.resolve().then(resolve, reject),
        }
        return done
      },
    }),
    update: (table) => ({
      set: (fields) => ({
        where: () => ({
          returning: () => {
            calls.updates.push({ table, fields })
            return Promise.resolve([{ ...fields }])
          },
          then: (resolve, reject) => {
            calls.updates.push({ table, fields })
            return Promise.resolve([]).then(resolve, reject)
          },
        }),
      }),
    }),
  }
}

// Stubs just the four youtube.* surfaces server/youtube.js touches.
function fakeYoutube(channelVideos, { commentCounts = {} } = {}) {
  return {
    channels: { list: async () => ({ data: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU_test' } } } ] } }) },
    playlistItems: {
      list: async () => ({
        data: {
          items: channelVideos.map((video) => ({
            contentDetails: { videoId: video.id, videoPublishedAt: video.publishedAt },
            snippet: { title: video.title, thumbnails: { medium: { url: video.thumbnailUrl } } },
          })),
        },
      }),
    },
    videos: {
      list: async () => ({
        data: {
          items: channelVideos.map((video) => ({ id: video.id, statistics: { commentCount: String(commentCounts[video.id] ?? 0) } })),
        },
      }),
    },
    commentThreads: { list: async () => ({ data: { items: [] } }) },
  }
}

const classify = () => 'other'
const weights = weightsFromCategories(DEFAULT_CATEGORIES)
const runningJob = (cursor = null) => ({ id: 'job1', creatorId: 'UC_test', status: 'running', cursor })

describe('advanceSyncJob — phase 1 (channel listing)', () => {
  const channelVideos = [
    { id: 'vid1', title: 'One', thumbnailUrl: 'http://t/1.jpg', publishedAt: '2026-01-01T00:00:00Z' },
    { id: 'vid2', title: 'Two', thumbnailUrl: 'http://t/2.jpg', publishedAt: '2026-02-01T00:00:00Z' },
  ]

  it('stores only video ids in the cursor, not full video records', async () => {
    const db = fakeDb()
    const job = await advanceSyncJob(db, runningJob(), fakeYoutube(channelVideos), classify, weights)
    expect(job.cursor).toEqual({ videoIds: ['vid1', 'vid2'], index: 0 })
    // The regression this guards: the cursor used to carry every video's
    // title/thumbnail/publishedAt and was rewritten on every chunk.
    expect(JSON.stringify(job.cursor)).not.toContain('thumbnail')
    expect(JSON.stringify(job.cursor)).not.toContain('One')
  })

  it('persists the video list immediately so the workspace is not empty mid-sync', async () => {
    const db = fakeDb()
    await advanceSyncJob(db, runningJob(), fakeYoutube(channelVideos), classify, weights)
    const videoInsert = db.calls.inserts.find((call) => call.rows.some((row) => row.id === 'vid1'))
    expect(videoInsert).toBeDefined()
    expect(videoInsert.rows).toHaveLength(2)
    expect(videoInsert.rows[0]).toMatchObject({ id: 'vid1', title: 'One', creatorId: 'UC_test' })
  })

  it('does not stamp a priority score before comments have been read', async () => {
    const db = fakeDb()
    await advanceSyncJob(db, runningJob(), fakeYoutube(channelVideos), classify, weights)
    const videoInsert = db.calls.inserts.find((call) => call.rows.some((row) => row.id === 'vid1'))
    // Writing 0 here would wipe an existing ranking on every re-sync.
    expect(videoInsert.rows[0]).not.toHaveProperty('priorityScore')
    expect(videoInsert.rows[0]).not.toHaveProperty('topPackId')
  })

  it('reports the total up front', async () => {
    const db = fakeDb()
    const job = await advanceSyncJob(db, runningJob(), fakeYoutube(channelVideos), classify, weights)
    expect(job.videosTotal).toBe(2)
    expect(job.status).toBe('running')
  })

  // Jobs written before the cursor was slimmed carry { videos: [...] }.
  it('redoes phase 1 for a legacy cursor shape instead of misreading it', async () => {
    const db = fakeDb()
    const legacy = { videos: [{ id: 'old', title: 'Old', commentCount: 0 }], index: 0 }
    const job = await advanceSyncJob(db, runningJob(legacy), fakeYoutube(channelVideos), classify, weights)
    expect(job.cursor).toEqual({ videoIds: ['vid1', 'vid2'], index: 0 })
  })
})

describe('advanceSyncJob — phase 2 (per-video comments)', () => {
  it('marks the job done once the cursor reaches the end of the id list', async () => {
    const db = fakeDb()
    const job = await advanceSyncJob(
      db,
      runningJob({ videoIds: ['vid1', 'vid2'], index: 2 }),
      fakeYoutube([]),
      classify,
      weights,
    )
    expect(job.status).toBe('done')
  })

  it('pauses instead of failing when the chunk would breach the quota cap', async () => {
    // Already at the per-creator cap, so any further paid work is refused.
    const db = fakeDb({ videos: [{ id: 'vid1', commentCount: 5, publishedAt: new Date() }], quotaUnits: 99_999 })
    const job = await advanceSyncJob(
      db,
      runningJob({ videoIds: ['vid1'], index: 0 }),
      fakeYoutube([]),
      classify,
      weights,
    )
    expect(job.status).toBe('paused_quota')
  })

  it('ignores jobs that are neither running nor quota-paused', async () => {
    const db = fakeDb()
    const done = { id: 'job1', creatorId: 'UC_test', status: 'done', cursor: { videoIds: [], index: 0 } }
    expect(await advanceSyncJob(db, done, fakeYoutube([]), classify, weights)).toBe(done)
    expect(db.calls.updates).toHaveLength(0)
  })
})
