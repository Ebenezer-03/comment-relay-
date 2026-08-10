import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowLeft, Check, ChevronDown, CircleHelp, ExternalLink, Inbox, Link2, MessageCircle, MoreHorizontal, Play, RefreshCw, Send, Sparkles, Video } from 'lucide-react'
import './styles.css'

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8787'

const PACK_LABELS = { install: 'Install error', env: 'Environment setup', praise: 'Positive feedback', other: 'Needs review' }

// Shown when no Google account is connected, so the app is still explorable
// without live data.
const demoClusters = [
  {
    id: 'install', label: 'Install error', count: 4, priority: 'High', tone: 'coral', summary: 'Viewers are blocked installing the MCP SDK.',
    draft: 'Hey! The package name has changed slightly since I recorded this. Run `npm install @modelcontextprotocol/sdk` and make sure you’re on Node 18 or newer. That should get you unstuck — let me know how it goes.',
    comments: [
      { id: 1, name: 'Priya N.', initials: 'PN', time: '12 min ago', text: 'getting an error when i run npm install, says package not found. is the command in the video outdated?', likes: 2 },
      { id: 2, name: 'Marcus Lee', initials: 'ML', time: '38 min ago', text: 'I followed every step but npm cannot find the mcp sdk package. Please help!', likes: 1 },
      { id: 3, name: 'Eli B.', initials: 'EB', time: '1 hr ago', text: 'Does this work with Node 16? install is failing for me.', likes: 0 },
      { id: 4, name: 'Sofia T.', initials: 'ST', time: '2 hr ago', text: 'package install error at 04:12 — would love an updated command', likes: 3 },
    ]
  },
  {
    id: 'env', label: 'Environment setup', count: 3, priority: 'Medium', tone: 'amber', summary: 'The API key setup step needs more context.',
    draft: 'The API key goes in a `.env` file at the root of the project. Name the variable `OPENAI_API_KEY`, then restart the dev server so it can load the new value.',
    comments: [
      { id: 5, name: 'Jules K.', initials: 'JK', time: '3 hr ago', text: 'where exactly do i put the API key? I don’t see that part in the repo.', likes: 4 },
      { id: 6, name: 'Ari Chen', initials: 'AC', time: '4 hr ago', text: 'My key is not being picked up. Do I need to restart something?', likes: 2 },
      { id: 7, name: 'Nikhil R.', initials: 'NR', time: '5 hr ago', text: 'Can you show the .env file setup in a follow-up?', likes: 1 },
    ]
  },
  {
    id: 'praise', label: 'Positive feedback', count: 6, priority: 'Low', tone: 'green', summary: 'Viewers are celebrating the clear walkthrough.',
    draft: 'Thanks for watching — glad the walkthrough helped! If you build something with it, I’d love to see what you make.',
    comments: [
      { id: 8, name: 'Maya R.', initials: 'MR', time: '6 hr ago', text: 'This is the clearest explanation of MCP servers I’ve seen. Thank you!', likes: 12 },
      { id: 9, name: 'Theo G.', initials: 'TG', time: '7 hr ago', text: 'Finally made one that works. Great tutorial.', likes: 8 },
    ]
  },
]

function formatRelative(iso) {
  if (!iso) return 'never synced'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} d ago`
}

function App() {
  const [liveSession, setLiveSession] = useState(() => sessionStorage.getItem('comment-relay-session') || '')

  // Workspace: the ranked list of a connected creator's videos.
  const [workspaceVideos, setWorkspaceVideos] = useState([])
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  // Sync is now a resumable background job (server/sync.js) rather than one
  // blocking call — this tracks its progress so large channels show a bar
  // instead of a spinner that never seems to finish.
  const [syncJob, setSyncJob] = useState(null)

  // Per-creator, editable classification categories (server/classify.js).
  const [categories, setCategories] = useState([])
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState('')

  // Reply desk: null activeVideo means "show the workspace list" when live,
  // or the built-in demo video when no Google account is connected.
  const [activeVideo, setActiveVideo] = useState(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [clusters, setClusters] = useState(demoClusters)
  const [activeId, setActiveId] = useState('install')
  const [selected, setSelected] = useState([1, 2])
  const [context, setContext] = useState('Node 18+ is required. The current install command is npm install @modelcontextprotocol/sdk. Keep replies practical and warm.')
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    const session = new URLSearchParams(window.location.search).get('session')
    if (session) {
      sessionStorage.setItem('comment-relay-session', session)
      setLiveSession(session)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  async function loadWorkspaceVideos() {
    setWorkspaceLoading(true)
    setWorkspaceError('')
    try {
      const response = await fetch(`${apiBase}/api/videos`, { headers: { 'X-Relay-Session': liveSession } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load videos.')
      setWorkspaceVideos(data.videos || [])
    } catch (error) {
      setWorkspaceError(error.message)
    }
    setWorkspaceLoading(false)
  }

  async function loadCategories() {
    setCategoriesLoading(true)
    setCategoriesError('')
    try {
      const response = await fetch(`${apiBase}/api/categories`, { headers: { 'X-Relay-Session': liveSession } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load categories.')
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
    setCategoriesLoading(false)
  }

  useEffect(() => {
    if (liveSession) {
      loadWorkspaceVideos()
      loadCategories()
    }
  }, [liveSession])

  // Guards against overlapping /api/videos/sync bursts (a ref, not state,
  // so the check is accurate even between renders) — two bursts racing on
  // the same job's cursor would step on each other's progress.
  const syncInFlightRef = useRef(false)

  async function syncWorkspaceVideos() {
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true
    setWorkspaceSyncing(true)
    setWorkspaceError('')
    try {
      const response = await fetch(`${apiBase}/api/videos/sync`, { method: 'POST', headers: { 'X-Relay-Session': liveSession } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Sync failed.')
      setWorkspaceVideos(data.videos || [])
      setSyncJob(data.job)
    } catch (error) {
      setWorkspaceError(error.message)
    }
    syncInFlightRef.current = false
    setWorkspaceSyncing(false)
  }

  // A single sync click only advances the job for ~20s server-side (see
  // server/sync.js) — large channels need more turns. While a job is still
  // running, keep re-triggering the next burst (skipped if one's already in
  // flight) so the creator doesn't have to keep clicking "Sync videos".
  useEffect(() => {
    if (!liveSession || syncJob?.status !== 'running') return
    const interval = setInterval(() => syncWorkspaceVideos(), 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSession, syncJob?.status])

  async function saveCategory(packId, fields) {
    setCategoriesError('')
    try {
      const response = await fetch(`${apiBase}/api/categories/${packId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Session': liveSession },
        body: JSON.stringify(fields),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save category.')
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
  }

  async function addCategory(fields) {
    setCategoriesError('')
    try {
      const response = await fetch(`${apiBase}/api/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Session': liveSession },
        body: JSON.stringify(fields),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not add category.')
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
  }

  async function deleteCategory(packId) {
    setCategoriesError('')
    try {
      const response = await fetch(`${apiBase}/api/categories/${packId}`, { method: 'DELETE', headers: { 'X-Relay-Session': liveSession } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not delete category.')
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
  }

  async function openVideo(videoId) {
    setVideoLoading(true)
    setWorkspaceError('')
    try {
      const response = await fetch(`${apiBase}/api/videos/${videoId}`, { headers: { 'X-Relay-Session': liveSession } })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not open this video.')
      setActiveVideo(data.video)
      setClusters(data.clusters)
      setActiveId(data.clusters[0]?.id || '')
      setSelected([])
      setSent(false)
      setSendError('')
    } catch (error) {
      setWorkspaceError(error.message)
    }
    setVideoLoading(false)
  }

  function backToWorkspace() {
    setActiveVideo(null)
  }

  const active = clusters.find((cluster) => cluster.id === activeId)
  const selectedCount = active ? active.comments.filter((comment) => selected.includes(comment.id)).length : 0
  const totalQuestions = clusters.reduce((sum, cluster) => sum + (cluster.id === 'praise' ? 0 : cluster.count), 0)

  const selectedComments = useMemo(() => active ? active.comments.filter((comment) => selected.includes(comment.id)) : [], [active, selected])

  function toggleComment(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    setSent(false)
  }

  function changeDraft(value) {
    setClusters((current) => current.map((cluster) => cluster.id === activeId ? { ...cluster, draft: value } : cluster))
  }

  async function saveDraft() {
    if (!liveSession || !activeVideo) return
    try {
      await fetch(`${apiBase}/api/videos/${activeVideo.id}/packs/${activeId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Session': liveSession },
        body: JSON.stringify({ draft: active.draft }),
      })
    } catch {
      // Non-fatal: the draft still lives in local state even if the save fails.
    }
  }

  async function sendReplies() {
    if (!selectedCount) return
    setSendError('')
    if (liveSession && activeVideo) {
      try {
        const response = await fetch(`${apiBase}/api/replies`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Relay-Session': liveSession }, body: JSON.stringify({ videoId: activeVideo.id, parentIds: selectedComments.map((comment) => comment.parentId || comment.id), text: active.draft }) })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Reply failed')
        const failures = data.results?.filter((result) => !result.ok) || []
        if (failures.length) throw new Error(`${failures.length} selected repl${failures.length === 1 ? 'y' : 'ies'} failed to send.`)
      } catch (error) {
        setSendError(error.message)
        return
      }
    }
    setSent(true)
  }

  const inWorkspaceList = liveSession && !activeVideo

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-fixed-top">
        <div className="brand"><span className="brand-mark"><MessageCircle size={17} fill="currentColor" /></span><span>comment relay</span></div>
        <div className="workspace-switcher"><span className="avatar avatar-purple">AK</span><span><strong>Alex Kim</strong><small>Creator workspace</small></span><ChevronDown size={15} /></div>
        <nav className="main-nav">
          <a className={!inWorkspaceList ? 'nav-active' : ''} onClick={backToWorkspace}><Inbox size={17} />Reply desk<span className="nav-count">{totalQuestions}</span></a>
          <a className={inWorkspaceList ? 'nav-active' : ''} onClick={backToWorkspace}><Video size={17} />Connected videos{liveSession && <span className="nav-count">{workspaceVideos.length}</span>}</a>
          <a><Check size={17} />Sent replies</a>
        </nav>
      </div>
      <div className="sidebar-scroll">
        <div className="side-label">WORKSPACE</div>
        {activeVideo
          ? <div className="video-mini"><div className="video-thumb">{activeVideo.thumbnailUrl ? <img src={activeVideo.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Play size={15} fill="white" />}</div><div><strong>{activeVideo.title}</strong><small>Synced {formatRelative(activeVideo.lastSyncedAt)}</small></div><MoreHorizontal size={16} /></div>
          : <div className="video-mini"><div className="video-thumb"><Play size={15} fill="white" /></div><div><strong>{liveSession ? `${workspaceVideos.length} video${workspaceVideos.length === 1 ? '' : 's'} connected` : 'Build an MCP server...'}</strong><small>{liveSession ? 'Pick one to reply' : '1 video connected'}</small></div><MoreHorizontal size={16} /></div>}
      </div>
      <div className="sidebar-bottom"><div className="context-note"><Sparkles size={15} /><span><strong>Context makes replies better</strong><small>Add your FAQ, known fixes, and voice here.</small></span></div><button className="link-button"><CircleHelp size={15} />Help & guidelines</button></div>
    </aside>

    <main className="main-content">
      {inWorkspaceList ? (
        <WorkspaceList
          videos={workspaceVideos}
          loading={workspaceLoading}
          syncing={workspaceSyncing}
          error={workspaceError}
          onSync={syncWorkspaceVideos}
          onOpen={openVideo}
          opening={videoLoading}
          syncJob={syncJob}
          categories={categories}
          onEditCategories={() => setCategoriesOpen(true)}
        />
      ) : (
        <>
          <header className="topbar">
            <div>
              {liveSession && <button className="secondary-button" style={{ marginBottom: 14 }} onClick={backToWorkspace}><ArrowLeft size={14} />Back to videos</button>}
              <div className="eyebrow">REPLY DESK{liveSession ? '' : ' / DEMO VIDEO'}</div>
              <h1>Answer the questions<br /><em>that keep coming up.</em></h1>
            </div>
            <div className="top-actions">
              {liveSession ? <span className="connected-badge"><span className="live-dot" /> Google connected</span> : <a className="connect-button" href={`${apiBase}/api/auth/google`}>Connect Google</a>}
              <button className="avatar avatar-purple">AK</button>
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
              <section className="cluster-rail"><div className="section-heading"><span>ANSWER PACKS</span><span className="muted">{clusters.length}</span></div><div className="pack-intro">Repeated questions, grouped so you can answer once.</div>{clusters.map((cluster) => <button className={`cluster-item ${activeId === cluster.id ? 'cluster-active' : ''}`} key={cluster.id} onClick={() => { setActiveId(cluster.id); setSelected([]); setSent(false) }}><div className="cluster-top"><span className={`priority-dot ${cluster.tone}`} /><strong>{cluster.label}</strong><span className="cluster-count">{cluster.count}</span></div><p>{cluster.summary}</p><div className="cluster-bottom"><span className={`priority ${cluster.tone}`}>{cluster.priority} priority</span><span>{activeId === cluster.id ? 'OPEN' : 'VIEW'}</span></div></button>)}</section>

              <section className="thread-panel"><div className="panel-head"><div><div className="eyebrow">PACK / {active.priority.toUpperCase()} PRIORITY</div><h2>{active.label}</h2></div><span className={`pill ${active.tone}`}>{active.count} similar comments</span></div><div className="rationale"><Sparkles size={15} /><span><strong>Why these are together</strong>{active.summary} The wording and intent match closely enough for one tailored answer.</span></div><div className="thread-list">{active.comments.map((comment) => <article className={`comment ${selected.includes(comment.id) ? 'comment-selected' : ''}`} key={comment.id}><button className={`checkbox ${selected.includes(comment.id) ? 'checked' : ''}`} onClick={() => toggleComment(comment.id)} aria-label={`Select ${comment.name}`}>{selected.includes(comment.id) && <Check size={13} />}</button><div className={`avatar avatar-${comment.id % 3 === 0 ? 'blue' : comment.id % 2 ? 'orange' : 'pink'}`}>{comment.initials}</div><div className="comment-body"><div className="comment-meta"><strong>{comment.name}</strong><span>{comment.time}</span><span className="comment-video">on this video</span></div><p>{comment.text}</p><div className="comment-actions"><span>♡ {comment.likes}</span><button>Open on YouTube <ExternalLink size={11} /></button></div></div></article>)}</div></section>

              <section className="composer-panel"><div className="panel-head composer-head"><div><div className="eyebrow">YOUR REPLY</div><h2>Draft once, send with care.</h2></div><span className="draft-badge"><Sparkles size={13} /> AI DRAFT</span></div><label className="field-label">Replying to <span>{selectedCount} selected {selectedCount === 1 ? 'comment' : 'comments'}</span></label><textarea value={active.draft} onChange={(event) => changeDraft(event.target.value)} onBlur={saveDraft} /><div className="context-section"><div className="field-label">CONTEXT USED <button className="tiny-button">Edit context <Link2 size={12} /></button></div><div className="context-chips"><span>Known fix</span><span>Creator voice</span><span>Video details</span></div><textarea className="context-input" value={context} onChange={(event) => setContext(event.target.value)} /></div><div className="composer-footer"><span className="character-count">{active.draft.length} / 800</span><button className="send-button" disabled={!selectedCount || sent} onClick={sendReplies}>{sent ? <><Check size={16} />Replies sent</> : <><Send size={16} />Reply selected <span>{selectedCount}</span></>}</button></div>{sent && <div className="success-note"><Check size={15} /> {selectedCount} reply results recorded. Nothing else was sent.</div>}{sendError && <div className="error-note">{sendError}</div>}<div className="consent-note">You always choose what gets sent. Comment Relay never auto-replies.</div></section>
            </div>
          )}
        </>
      )}
    </main>
    {categoriesOpen && (
      <CategoriesPanel
        categories={categories}
        loading={categoriesLoading}
        error={categoriesError}
        onSave={saveCategory}
        onAdd={addCategory}
        onDelete={deleteCategory}
        onClose={() => setCategoriesOpen(false)}
      />
    )}
  </div>
}

function SyncProgress({ job }) {
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

function WorkspaceList({ videos, loading, syncing, error, onSync, onOpen, opening, syncJob, categories, onEditCategories }) {
  const packLabel = (packId) => categories.find((category) => category.packId === packId)?.label || PACK_LABELS[packId] || packId
  return <>
    <header className="topbar">
      <div><div className="eyebrow">WORKSPACE / ALL VIDEOS</div><h1>Which video needs<br /><em>your attention first?</em></h1></div>
      <div className="top-actions">
        <button className="secondary-button" onClick={onEditCategories}><Sparkles size={15} />Edit categories</button>
        <button className="secondary-button" onClick={onSync} disabled={syncing}><RefreshCw size={15} className={syncing ? 'spin' : ''} />{syncing ? 'Syncing…' : 'Sync videos'}</button>
        <button className="avatar avatar-purple">AK</button>
      </div>
    </header>
    <SyncProgress job={syncJob} />
    {error && <div className="error-note" style={{ marginBottom: 16 }}>{error}</div>}
    {loading ? <p className="pack-intro">Loading your videos…</p> : videos.length === 0 ? (
      <div className="rationale" style={{ maxWidth: 480 }}><Sparkles size={15} /><span><strong>No videos synced yet</strong>Click "Sync videos" to pull every video on your channel, ranked by how urgent the comments look.</span></div>
    ) : (
      <div className="video-list">
        {videos.map((video) => <button key={video.id} className="video-card" onClick={() => onOpen(video.id)} disabled={opening}>
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
    )}
  </>
}

function CategoryRow({ category, onSave, onDelete }) {
  const [label, setLabel] = useState(category.label)
  const [priority, setPriority] = useState(category.priority)
  const [keywords, setKeywords] = useState((category.keywords || []).join(', '))
  const [saving, setSaving] = useState(false)
  const dirty = label !== category.label || priority !== category.priority || keywords !== (category.keywords || []).join(', ')

  async function save() {
    setSaving(true)
    await onSave(category.packId, { label, priority, keywords: keywords.split(',').map((word) => word.trim()).filter(Boolean) })
    setSaving(false)
  }

  return (
    <div className="category-row">
      <span className={`priority-dot ${category.tone}`} />
      <input value={label} onChange={(event) => setLabel(event.target.value)} />
      <select value={priority} onChange={(event) => setPriority(event.target.value)}>
        <option>High</option><option>Medium</option><option>Low</option>
      </select>
      <input
        className="category-keywords"
        value={keywords}
        onChange={(event) => setKeywords(event.target.value)}
        placeholder={category.isFallback ? 'catch-all — no keywords needed' : 'comma-separated trigger words'}
        disabled={category.isFallback}
      />
      <button className="tiny-button" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save'}</button>
      {!category.isFallback && <button className="tiny-button" onClick={() => onDelete(category.packId)}>Delete</button>}
    </div>
  )
}

function AddCategoryForm({ onAdd }) {
  const [packId, setPackId] = useState('')
  const [label, setLabel] = useState('')
  const [keywords, setKeywords] = useState('')
  const [adding, setAdding] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!packId.trim() || !label.trim()) return
    setAdding(true)
    await onAdd({
      packId: packId.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      label: label.trim(),
      keywords: keywords.split(',').map((word) => word.trim()).filter(Boolean),
    })
    setPackId(''); setLabel(''); setKeywords('')
    setAdding(false)
  }

  return (
    <form className="category-row category-row-add" onSubmit={submit}>
      <input placeholder="id (e.g. pricing)" value={packId} onChange={(event) => setPackId(event.target.value)} />
      <input placeholder="Label" value={label} onChange={(event) => setLabel(event.target.value)} />
      <input className="category-keywords" placeholder="comma-separated trigger words" value={keywords} onChange={(event) => setKeywords(event.target.value)} />
      <button className="tiny-button" type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add category'}</button>
    </form>
  )
}

// Lets a creator edit the categories their comments are sorted into
// (server/classify.js) instead of being stuck with one hardcoded, one-niche
// keyword list. Keywords are matched top-to-bottom, case-insensitive.
function CategoriesPanel({ categories, loading, error, onSave, onAdd, onDelete, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel-head">
          <div><div className="eyebrow">CLASSIFICATION</div><h2>Categories</h2></div>
          <button className="tiny-button" onClick={onClose}>Close</button>
        </div>
        <p className="pack-intro">Comments are sorted into whichever category matches first, top to bottom. Keywords are matched as substrings, case-insensitive.</p>
        {error && <div className="error-note">{error}</div>}
        {loading ? <p className="pack-intro">Loading…</p> : (
          <div className="category-list">
            {categories.map((category) => <CategoryRow key={category.packId} category={category} onSave={onSave} onDelete={onDelete} />)}
            <AddCategoryForm onAdd={onAdd} />
          </div>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
