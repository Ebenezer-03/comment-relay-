import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ExternalLink, Send, Sparkles, Video } from 'lucide-react'
import { useAppState } from '../context/AppState.jsx'
import { formatRelative, avatarTone, initialsFor } from '../utils/format.js'

const DEMO_NAME = 'Alex Kim'

// The reply-desk workbench. `/` shows whichever video was last opened (or
// auto-opens the creator's top-priority video); `/reply-desk/:videoId` deep
// links to one specific video. Falls back to demoClusters (AppState) when
// no Google account is connected, same as the original single-file app.
export default function ReplyDesk() {
  const { videoId } = useParams()
  const navigate = useNavigate()
  const {
    liveSession, creator, workspaceVideos, videosTotal, videoLoading, activeVideo, clusters, active, activeId, setActiveId,
    selected, setSelected, sent, sendError, openVideo, backToWorkspace, toggleComment, changeDraft, saveDraft,
    changeContext, saveContext, sendReplies, selectedCount, totalQuestions, reclassifyWithAI, reclassifying,
    generateDraft, draftGenerating, aiError,
  } = useAppState()

  // Deep link: open the requested video if it isn't already open.
  useEffect(() => {
    if (liveSession && videoId) openVideo(videoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSession, videoId])

  // No explicit video in the URL: send the creator straight to whichever
  // video needs attention first, once the workspace list has loaded.
  useEffect(() => {
    if (liveSession && !videoId && !activeVideo && workspaceVideos.length) {
      navigate(`/reply-desk/${workspaceVideos[0].id}`, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSession, videoId, activeVideo, workspaceVideos])

  function goToVideos() {
    backToWorkspace()
    navigate('/videos')
  }

  const displayName = liveSession && creator ? (creator.channelTitle || creator.email || 'Connected creator') : DEMO_NAME
  const initials = initialsFor(displayName)

  if (liveSession && !videoId && !activeVideo) {
    if (workspaceVideos.length === 0 && videosTotal === 0) {
      return (
        <>
          <header className="topbar">
            <div><div className="eyebrow">REPLY DESK</div><h1>Answer the questions<br /><em>that keep coming up.</em></h1></div>
          </header>
          <div className="rationale" style={{ maxWidth: 480 }}><Sparkles size={15} /><span><strong>No videos synced yet</strong>Head to Connected videos and click "Sync videos" to pull your channel in, ranked by how urgent the comments look.</span></div>
        </>
      )
    }
    return <p className="pack-intro">Loading…</p>
  }

  return (
    <>
      <header className="topbar">
        <div>
          {liveSession && <button className="secondary-button" style={{ marginBottom: 14 }} onClick={goToVideos}><ArrowLeft size={14} />Back to videos</button>}
          <div className="eyebrow">REPLY DESK{liveSession ? '' : ' / DEMO VIDEO'}</div>
          <h1>Answer the questions<br /><em>that keep coming up.</em></h1>
        </div>
        <div className="top-actions">
          {liveSession ? <span className="connected-badge"><span className="live-dot" /> Google connected</span> : <a className="connect-button" href={`${import.meta.env.VITE_API_BASE || 'http://localhost:8787'}/api/auth/google`}>Connect Google</a>}
          <button className="avatar avatar-purple">{initials}</button>
        </div>
      </header>

      <section className="video-bar">
        <div className="video-identity">
          <div className="video-square">{activeVideo?.thumbnailUrl ? <img src={activeVideo.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} /> : <Video size={20} />}</div>
          <div><strong>{activeVideo?.title || 'Build your first MCP server with Node.js'}</strong><small><span className="live-dot" /> {activeVideo ? `Synced ${formatRelative(activeVideo.lastSyncedAt)}` : 'Demo data — connect Google to see your real videos'} <ExternalLink size={12} /></small></div>
        </div>
        <div className="video-controls">
          <div className="video-stats"><span><strong>{totalQuestions}</strong> questions grouped</span><span><strong>{clusters.length}</strong> answer packs ready</span></div>
        </div>
      </section>

      {videoLoading ? <p className="pack-intro">Loading…</p> : !active ? (
        <div className="rationale" style={{ maxWidth: 480 }}><Sparkles size={15} /><span><strong>No comments to group yet</strong>This video hasn't picked up any comments matching the answer-pack categories. Try again after it gets more engagement.</span></div>
      ) : (
        <div className="workbench">
          <section className="cluster-rail">
            <div className="section-heading">
              <span>ANSWER PACKS</span>
              {liveSession && activeVideo
                ? <button className="tiny-button" onClick={reclassifyWithAI} disabled={reclassifying} title="Re-sort comments with AI instead of keyword matching">
                    <Sparkles size={11} className={reclassifying ? 'spin' : ''} />{reclassifying ? 'Reclassifying…' : 'Reclassify with AI'}
                  </button>
                : <span className="muted">{clusters.length}</span>}
            </div>
            <div className="pack-intro">Repeated questions, grouped so you can answer once.</div>
            {clusters.map((cluster) => <button className={`cluster-item ${activeId === cluster.id ? 'cluster-active' : ''}`} key={cluster.id} onClick={() => { setActiveId(cluster.id); setSelected([]); }}><div className="cluster-top"><span className={`priority-dot ${cluster.tone}`} /><strong>{cluster.label}</strong><span className="cluster-count">{cluster.count}</span></div><p>{cluster.summary}</p><div className="cluster-bottom"><span className={`priority ${cluster.tone}`}>{cluster.priority} priority</span><span>{activeId === cluster.id ? 'OPEN' : 'VIEW'}</span></div></button>)}
          </section>

          <section className="thread-panel">
            <div className="panel-head"><div><div className="eyebrow">PACK / {active.priority.toUpperCase()} PRIORITY</div><h2>{active.label}</h2></div><span className={`pill ${active.tone}`}>{active.count} similar comments</span></div>
            <div className="rationale"><Sparkles size={15} /><span><strong>Why these are together</strong>{active.summary} The wording and intent match closely enough for one tailored answer.</span></div>
            <div className="thread-list">{active.comments.map((comment) => <article className={`comment ${selected.includes(comment.id) ? 'comment-selected' : ''}`} key={comment.id}><button className={`checkbox ${selected.includes(comment.id) ? 'checked' : ''}`} onClick={() => toggleComment(comment.id)} aria-label={`Select ${comment.name}`}>{selected.includes(comment.id) && <Check size={13} />}</button><div className={`avatar avatar-${avatarTone(comment.id)}`}>{comment.initials}</div><div className="comment-body"><div className="comment-meta"><strong>{comment.name}</strong><span>{comment.time}</span><span className="comment-video">on this video</span></div><p>{comment.text}</p><div className="comment-actions"><span>♡ {comment.likes}</span><button>Open on YouTube <ExternalLink size={11} /></button></div></div></article>)}</div>
          </section>

          <section className="composer-panel">
            <div className="panel-head composer-head">
              <div><div className="eyebrow">YOUR REPLY</div><h2>Draft once, send with care.</h2></div>
              {liveSession && activeVideo
                ? <button className="draft-badge" onClick={generateDraft} disabled={draftGenerating} style={{ border: 0, background: 'none', cursor: 'pointer' }}><Sparkles size={13} className={draftGenerating ? 'spin' : ''} /> {draftGenerating ? 'DRAFTING…' : 'AI DRAFT'}</button>
                : <span className="draft-badge"><Sparkles size={13} /> AI DRAFT</span>}
            </div>
            <label className="field-label">Replying to <span>{selectedCount} selected {selectedCount === 1 ? 'comment' : 'comments'}</span></label>
            <textarea value={active.draft} onChange={(event) => changeDraft(event.target.value)} onBlur={saveDraft} />
            <div className="context-section">
              <div className="field-label">CONTEXT USED</div>
              <div className="context-chips"><span>Known fix</span><span>Creator voice</span><span>Video details</span></div>
              <textarea className="context-input" value={active.context || ''} onChange={(event) => changeContext(event.target.value)} onBlur={saveContext} placeholder="Known fixes, your voice, video-specific details…" />
            </div>
            <div className="composer-footer">
              <span className="character-count">{active.draft.length} / 800</span>
              <button className="send-button" disabled={!selectedCount || sent} onClick={sendReplies}>{sent ? <><Check size={16} />Replies sent</> : <><Send size={16} />Reply selected <span>{selectedCount}</span></>}</button>
            </div>
            {sent && <div className="success-note"><Check size={15} /> {selectedCount} reply results recorded. Nothing else was sent.</div>}
            {sendError && <div className="error-note">{sendError}</div>}
            {aiError && <div className="error-note">{aiError}</div>}
            <div className="consent-note">You always choose what gets sent. Comment Relay never auto-replies.</div>
          </section>
        </div>
      )}
    </>
  )
}
