import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Bot, Check, CheckCheck, ExternalLink, Send, Sparkles, Video } from 'lucide-react'
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
    selected, setSelected, sent, lastSentCount, sendError, sending, openVideo, backToWorkspace, toggleComment, selectAllActiveComments, clearSelection, changeDraft, saveDraft,
    changeContext, saveContext, sendReplies, selectedCount, totalQuestions, reclassifyWithAI, reclassifying,
    generateDraft, draftGenerating, aiError,
    escalations, agentTriageRunning, agentReport, runStrandsAgentTriage, resolveEscalation, setAccountOpen,
  } = useAppState()

  const [filterMode, setFilterMode] = useState('all')
  const unansweredComments = active?.comments.filter((c) => !c.isReplied) || []
  const repliedComments = active?.comments.filter((c) => c.isReplied) || []
  const displayedComments = (active?.comments || []).filter((c) => {
    if (filterMode === 'unanswered') return !c.isReplied
    if (filterMode === 'replied') return c.isReplied
    return true
  })

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
          {liveSession && activeVideo && (
            <button
              className="secondary-button"
              onClick={runStrandsAgentTriage}
              disabled={agentTriageRunning}
              title="Run autonomous community triage with Strands Agents SDK on Amazon Bedrock"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <Bot size={15} />
              {agentTriageRunning ? 'Agent Triaging…' : 'Run Strands Agent'}
            </button>
          )}
          {liveSession ? <span className="connected-badge"><span className="live-dot" /> Google connected</span> : <a className="connect-button" href={`${import.meta.env.VITE_API_BASE || 'http://localhost:8787'}/api/auth/google`}>Connect Google</a>}
          <button className="avatar avatar-purple" onClick={() => setAccountOpen(true)} title="View account details">{initials}</button>
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

      {escalations.length > 0 && (
        <section className="banner-escalation" role="region" aria-label="Strands Agent Escalations" aria-live="polite">
          <div className="banner-escalation-header">
            <AlertTriangle size={18} />
            <span>Strands Agent Surfaced {escalations.length} Decision{escalations.length === 1 ? '' : 's'} Requiring Your Human Judgment</span>
          </div>
          <div className="banner-escalation-list">
            {escalations.map((item) => (
              <div key={item.id} className="banner-escalation-item">
                <div className="banner-escalation-text">
                  <strong>{item.authorName || 'Commenter'}:</strong> "{item.commentText.slice(0, 120)}{item.commentText.length > 120 ? '…' : ''}"
                  <div className="banner-escalation-reason">
                    <strong>Urgency Reason:</strong> {item.urgencyReason} · <em>Recommended: {item.recommendedAction}</em>
                  </div>
                </div>
                <button className="secondary-button" style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }} onClick={() => resolveEscalation(item.id)}>
                  <Check size={13} /> Resolve
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {agentReport && (
        <div className="banner-report" role="status" aria-live="polite">
          <Sparkles size={16} />
          <span><strong>Strands Agent Report:</strong> Triaged {agentReport.triagedCount} comments into answer packs · {agentReport.escalatedCount} human decisions surfaced · {agentReport.draftsUpdated} drafts generated.</span>
        </div>
      )}

      {videoLoading ? (
        <div className="skeleton-container" role="status" aria-label="Loading video and answer packs">
          <div className="skeleton-box" style={{ height: 42, width: '100%' }} />
          <div className="skeleton-box" style={{ height: 550, width: '100%' }} />
        </div>
      ) : !active ? (
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
            <div className="panel-head">
              <div>
                <div className="eyebrow">PACK / {active.priority.toUpperCase()} PRIORITY</div>
                <h2>{active.label}</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {unansweredComments.length > 0 ? (
                  <button
                    className="tiny-button"
                    onClick={selectedCount === unansweredComments.length ? clearSelection : selectAllActiveComments}
                    title={selectedCount === unansweredComments.length ? 'Deselect all comments' : 'Select all unanswered comments in this pack'}
                  >
                    <CheckCheck size={13} />
                    {selectedCount === unansweredComments.length ? 'Deselect all' : `Select unanswered (${unansweredComments.length})`}
                  </button>
                ) : (
                  <span className="pill green" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Check size={12} /> All answered
                  </span>
                )}
                <span className={`pill ${active.count > 0 ? active.tone : 'green'}`}>
                  {active.count === 0 ? '0 pending' : `${active.count} pending`}
                </span>
              </div>
            </div>
            <div className="rationale"><Sparkles size={15} /><span><strong>Why these are together</strong>{active.summary} The wording and intent match closely enough for one tailored answer.</span></div>

            <div className="thread-filter-bar">
              <button
                type="button"
                className={`filter-chip ${filterMode === 'all' ? 'active' : ''}`}
                onClick={() => setFilterMode('all')}
              >
                All ({active.comments.length})
              </button>
              <button
                type="button"
                className={`filter-chip ${filterMode === 'unanswered' ? 'active' : ''}`}
                onClick={() => setFilterMode('unanswered')}
              >
                Unanswered ({unansweredComments.length})
              </button>
              {repliedComments.length > 0 && (
                <button
                  type="button"
                  className={`filter-chip ${filterMode === 'replied' ? 'active' : ''}`}
                  onClick={() => setFilterMode('replied')}
                >
                  Answered ({repliedComments.length})
                </button>
              )}
            </div>

            <div className="thread-list">
              {displayedComments.map((comment) => (
                <article className={`comment ${comment.isReplied ? 'comment-replied' : ''} ${selected.includes(comment.id) ? 'comment-selected' : ''}`} key={comment.id}>
                  <button
                    className={`checkbox ${selected.includes(comment.id) ? 'checked' : ''}`}
                    onClick={() => toggleComment(comment.id)}
                    role="checkbox"
                    aria-checked={selected.includes(comment.id)}
                    aria-label={`Select comment by ${comment.name}`}
                    title={comment.isReplied ? 'Already replied to' : 'Select comment'}
                  >
                    {selected.includes(comment.id) && <Check size={14} />}
                  </button>
                  <div className={`avatar avatar-${avatarTone(comment.id)}`}>{comment.initials}</div>
                  <div className="comment-body">
                    <div className="comment-meta">
                      <strong>{comment.name}</strong>
                      {comment.isReplied && (
                        <span className="pill green" style={{ fontSize: 10, padding: '1px 6px', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Check size={10} /> Replied
                        </span>
                      )}
                      <span>{comment.time}</span>
                      <span className="comment-video">on this video</span>
                    </div>
                    <p>{comment.text}</p>
                    <div className="comment-actions">
                      <span>♡ {comment.likes}</span>
                      <a
                        href={activeVideo ? `https://www.youtube.com/watch?v=${activeVideo.id}&lc=${comment.id}` : 'https://www.youtube.com'}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: 'inherit' }}
                        title="Open comment on YouTube in a new tab"
                      >
                        Open on YouTube <ExternalLink size={11} />
                      </a>
                    </div>
                  </div>
                </article>
              ))}
              {displayedComments.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--fg-muted)', fontSize: 13 }}>
                  {filterMode === 'unanswered' ? (
                    <>
                      <div style={{ fontSize: 22, marginBottom: 6 }}>🎉</div>
                      <strong>All caught up!</strong>
                      <p style={{ margin: '4px 0 10px', fontSize: 12, color: 'var(--fg-subtle)' }}>Every comment in this pack has received a reply.</p>
                      <button className="tiny-button" onClick={() => setFilterMode('all')}>View all comments</button>
                    </>
                  ) : (
                    <span>No comments in this view.</span>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="composer-panel">
            <div className="panel-head composer-head">
              <div><div className="eyebrow">YOUR REPLY</div><h2>Draft once, send with care.</h2></div>
              {liveSession && activeVideo
                ? <button className="draft-badge" onClick={generateDraft} disabled={draftGenerating} style={{ border: 0, background: 'none', cursor: 'pointer' }}><Sparkles size={13} className={draftGenerating ? 'spin' : ''} /> {draftGenerating ? 'DRAFTING…' : 'AI DRAFT'}</button>
                : <span className="draft-badge"><Sparkles size={13} /> AI DRAFT</span>}
            </div>
            <label className="field-label">Replying to <span>{selectedCount} selected {selectedCount === 1 ? 'comment' : 'comments'}</span></label>
            <textarea value={active.draft} onChange={(event) => changeDraft(event.target.value)} onBlur={saveDraft} disabled={sending} />
            <div className="context-section">
              <div className="field-label">CONTEXT USED</div>
              <div className="context-chips"><span>Known fix</span><span>Creator voice</span><span>Video details</span></div>
              <textarea className="context-input" value={active.context || ''} onChange={(event) => changeContext(event.target.value)} onBlur={saveContext} placeholder="Known fixes, your voice, video-specific details…" />
            </div>
            <div className="composer-footer">
              <span
                className="character-count"
                style={{
                  color: active.draft.length > 800 ? 'var(--danger-text)' : active.draft.length > 700 ? 'var(--warning-accent)' : undefined,
                  fontWeight: active.draft.length > 700 ? 600 : undefined,
                }}
              >
                {active.draft.length} / 800
              </span>
              <button
                className="send-button"
                disabled={!selectedCount || sent || sending || active.draft.length > 800}
                onClick={sendReplies}
              >
                {sending ? (
                  <><Send size={16} className="spin" /> Sending to {selectedCount}…</>
                ) : sent ? (
                  <><Check size={16} />Replies sent</>
                ) : (
                  <><Send size={16} />Reply selected <span>{selectedCount}</span></>
                )}
              </button>
            </div>
            {sent && <div className="success-note" role="status"><Check size={15} /> {lastSentCount || 1} repl{(lastSentCount || 1) === 1 ? 'y' : 'ies'} sent to YouTube! Marked as answered.</div>}
            {sendError && <div className="error-note" role="alert">{sendError}</div>}
            {aiError && <div className="error-note" role="alert">{aiError}</div>}
            <div className="consent-note">You always choose what gets sent. Comment Relay never auto-replies.</div>
          </section>
        </div>
      )}
    </>
  )
}
