import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Sparkles, Video, X } from 'lucide-react'
import { useAppState } from '../context/AppState.jsx'
import { apiFetch } from '../api.js'
import { formatRelative, initialsFor } from '../utils/format.js'

const DEMO_NAME = 'Alex Kim'
const LIMIT = 20

// Reply send history — server/index.js's POST /api/replies has always
// written to sentReplies, but until now nothing read it back and this nav
// item ("Sent replies") was inert. Backed by GET /api/sent-replies.
export default function SentReplies() {
  const { liveSession, creator, setAccountOpen } = useAppState()
  const [replies, setReplies] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const displayName = liveSession && creator ? (creator.channelTitle || creator.email || 'Connected creator') : DEMO_NAME
  const initials = initialsFor(displayName)

  const load = useCallback(async (nextOffset = 0) => {
    if (!liveSession) return
    setLoading(true)
    setError('')
    try {
      const data = await apiFetch(`/api/sent-replies?limit=${LIMIT}&offset=${nextOffset}`, { session: liveSession })
      setReplies(data.replies || [])
      setTotal(data.total ?? (data.replies || []).length)
      setOffset(nextOffset)
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }, [liveSession])

  useEffect(() => { load(0) }, [load])

  const page = Math.floor(offset / LIMIT) + 1
  const pageCount = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">WORKSPACE / HISTORY</div><h1>Every reply<br /><em>you've actually sent.</em></h1></div>
        <div className="top-actions"><button className="avatar avatar-purple" onClick={() => setAccountOpen(true)} title="View account details">{initials}</button></div>
      </header>

      {!liveSession ? (
        <div className="rationale" style={{ maxWidth: 480 }}><Sparkles size={15} /><span><strong>Connect Google to see sent replies</strong>This history is per-creator — connect your account to view what you've sent.</span></div>
      ) : error ? (
        <div className="error-note" role="alert" style={{ marginBottom: 16 }}>{error}</div>
      ) : loading ? (
        <div className="skeleton-container" role="status" aria-label="Loading sent replies history">
          <div className="skeleton-box" style={{ height: 68, width: '100%' }} />
          <div className="skeleton-box" style={{ height: 68, width: '100%' }} />
        </div>
      ) : replies.length === 0 ? (
        <div className="rationale" style={{ maxWidth: 480 }}><Sparkles size={15} /><span><strong>No replies sent yet</strong>Once you send replies from the reply desk, they'll show up here.</span></div>
      ) : (
        <>
          <div className="video-list">
            {replies.map((reply) => (
              <div key={reply.id} className="video-card" style={{ cursor: 'default' }}>
                <div className="video-card-thumb">{reply.videoThumbnailUrl ? <img src={reply.videoThumbnailUrl} alt="" /> : <Video size={22} />}</div>
                <div className="video-card-body">
                  <strong>{reply.videoTitle || 'Video no longer available'}</strong>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: '#5a615b', lineHeight: 1.5 }}>{reply.text}</p>
                  <div className="video-card-meta">
                    <span>{reply.parentIds?.length || 0} comment{(reply.parentIds?.length || 0) === 1 ? '' : 's'} replied to</span>
                    <span>Sent {formatRelative(reply.sentAt)}</span>
                  </div>
                </div>
                <span className={`pill ${reply.ok ? 'green' : 'coral'}`} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }}>
                  {reply.ok ? <><Check size={11} />Sent</> : <><X size={11} />Failed</>}
                </span>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="pager">
              <button className="secondary-button" onClick={() => load(Math.max(0, offset - LIMIT))} disabled={page <= 1}><ChevronLeft size={14} />Prev</button>
              <span className="pager-status">Page {page} of {pageCount} · {total} replies</span>
              <button className="secondary-button" onClick={() => load(offset + LIMIT)} disabled={page >= pageCount}>Next<ChevronRight size={14} /></button>
            </div>
          )}
        </>
      )}
    </>
  )
}
