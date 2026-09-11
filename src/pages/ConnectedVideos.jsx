import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, RefreshCw, Sparkles, Video } from 'lucide-react'
import { useAppState } from '../context/AppState.jsx'
import { formatRelative, initialsFor } from '../utils/format.js'
import { PACK_LABELS } from '../data/demoClusters.js'
import SyncProgress from '../components/SyncProgress.jsx'

const DEMO_NAME = 'Alex Kim'

// The full list of a creator's synced videos — previously collapsed into
// the same view as "Reply desk" (both nav items called the same
// backToWorkspace() toggle). Now its own route, deep-linkable at /videos.
export default function ConnectedVideos() {
  const navigate = useNavigate()
  const {
    liveSession, creator, workspaceVideos, videosTotal, videosOffset, videosLimit, loadWorkspaceVideos,
    workspaceLoading, workspaceSyncing, workspaceError, syncWorkspaceVideos, videoLoading, syncJob,
    categories, setCategoriesOpen, setAccountOpen,
  } = useAppState()

  const displayName = liveSession && creator ? (creator.channelTitle || creator.email || 'Connected creator') : DEMO_NAME
  const initials = initialsFor(displayName)
  const packLabel = (packId) => categories.find((category) => category.packId === packId)?.label || PACK_LABELS[packId] || packId

  if (!liveSession) {
    return (
      <>
        <header className="topbar">
          <div><div className="eyebrow">WORKSPACE / ALL VIDEOS</div><h1>Which video needs<br /><em>your attention first?</em></h1></div>
        </header>
        <div className="rationale" style={{ maxWidth: 480 }}>
          <Sparkles size={15} />
          <span><strong>Connect Google to see your videos</strong>This list is built from your real channel once you connect — until then the reply desk shows demo data.</span>
        </div>
        <a className="connect-button" href={`${import.meta.env.VITE_API_BASE || 'http://localhost:8787'}/api/auth/google`}>Connect Google</a>
      </>
    )
  }

  const page = Math.floor(videosOffset / videosLimit) + 1
  const pageCount = Math.max(1, Math.ceil(videosTotal / videosLimit))

  function openVideo(videoId) {
    navigate(`/reply-desk/${videoId}`)
  }

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">WORKSPACE / ALL VIDEOS</div><h1>Which video needs<br /><em>your attention first?</em></h1></div>
        <div className="top-actions">
          <button className="secondary-button" onClick={() => setCategoriesOpen(true)}><Sparkles size={15} />Edit categories</button>
          <button className="secondary-button" onClick={syncWorkspaceVideos} disabled={workspaceSyncing}><RefreshCw size={15} className={workspaceSyncing ? 'spin' : ''} />{workspaceSyncing ? 'Syncing…' : 'Sync videos'}</button>
          <button className="avatar avatar-purple" onClick={() => setAccountOpen(true)} title="View account details">{initials}</button>
        </div>
      </header>
      <SyncProgress job={syncJob} />
      {workspaceError && <div className="error-note" role="alert" style={{ marginBottom: 16 }}>{workspaceError}</div>}
      {workspaceLoading ? (
        <div className="skeleton-container" role="status" aria-label="Loading your videos">
          <div className="skeleton-box" style={{ height: 68, width: '100%' }} />
          <div className="skeleton-box" style={{ height: 68, width: '100%' }} />
          <div className="skeleton-box" style={{ height: 68, width: '100%' }} />
        </div>
      ) : workspaceVideos.length === 0 ? (
        <div className="rationale" style={{ maxWidth: 480 }}><Sparkles size={15} /><span><strong>No videos synced yet</strong>Click "Sync videos" to pull every video on your channel, ranked by how urgent the comments look.</span></div>
      ) : (
        <>
          <div className="video-list">
            {workspaceVideos.map((video) => <button key={video.id} className="video-card" onClick={() => openVideo(video.id)} disabled={videoLoading}>
              <div className="video-card-thumb">{video.thumbnailUrl ? <img src={video.thumbnailUrl} alt="" /> : <Video size={22} />}</div>
              <div className="video-card-body">
                <strong>{video.title}</strong>
                <div className="video-card-meta">
                  <span>{video.commentCount} comment{video.commentCount === 1 ? '' : 's'}</span>
                  {video.topPackId && <span className="video-card-pack">{packLabel(video.topPackId)}</span>}
                  <span>Synced {formatRelative(video.lastSyncedAt)}</span>
                </div>
              </div>
              <div className="video-card-score" title="Priority score: comment urgency weighted by recency">{video.priorityScore}</div>
            </button>)}
          </div>
          {pageCount > 1 && (
            <div className="pager">
              <button className="secondary-button" onClick={() => loadWorkspaceVideos(Math.max(0, videosOffset - videosLimit))} disabled={page <= 1}><ChevronLeft size={14} />Prev</button>
              <span className="pager-status">Page {page} of {pageCount} · {videosTotal} videos</span>
              <button className="secondary-button" onClick={() => loadWorkspaceVideos(videosOffset + videosLimit)} disabled={page >= pageCount}>Next<ChevronRight size={14} /></button>
            </div>
          )}
        </>
      )}
    </>
  )
}
