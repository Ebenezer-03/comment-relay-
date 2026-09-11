import { RefreshCw } from 'lucide-react'

export default function SyncProgress({ job }) {
  if (!job || job.status === 'done') return null
  if (job.status === 'error') return <div className="error-note" style={{ marginBottom: 16 }}>Sync failed: {job.error}</div>
  const pct = job.videosTotal ? Math.round((job.videosProcessed / job.videosTotal) * 100) : 0
  return (
    <div className="rationale" style={{ marginBottom: 16, alignItems: 'center' }}>
      <RefreshCw size={15} className={job.status === 'running' ? 'spin' : ''} />
      <span style={{ flex: 1 }}>
        <strong>{job.status === 'paused_quota' ? 'Paused — daily quota reached' : 'Syncing your channel'}</strong>
        {job.status === 'paused_quota'
          ? `Picks back up automatically once quota resets. ${job.videosProcessed}/${job.videosTotal} videos done so far.`
          : `${job.videosProcessed} of ${job.videosTotal} videos processed.`}
        <div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${pct}%` }} /></div>
      </span>
    </div>
  )
}
