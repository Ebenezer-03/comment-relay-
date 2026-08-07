import { StrictMode, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Check, ChevronDown, CircleHelp, ExternalLink, Inbox, Link2, MessageCircle, MoreHorizontal, Play, RefreshCw, Send, Sparkles, Video } from 'lucide-react'
import './styles.css'

const initialClusters = [
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

function App() {
  const [clusters, setClusters] = useState(initialClusters)
  const [activeId, setActiveId] = useState('install')
  const [selected, setSelected] = useState([1, 2])
  const [context, setContext] = useState('Node 18+ is required. The current install command is npm install @modelcontextprotocol/sdk. Keep replies practical and warm.')
  const [synced, setSynced] = useState('2 min ago')
  const [sent, setSent] = useState(false)

  const active = clusters.find((cluster) => cluster.id === activeId)
  const selectedCount = active.comments.filter((comment) => selected.includes(comment.id)).length
  const totalQuestions = clusters.reduce((sum, cluster) => sum + (cluster.id === 'praise' ? 0 : cluster.count), 0)

  const selectedComments = useMemo(() => active.comments.filter((comment) => selected.includes(comment.id)), [active, selected])

  function toggleComment(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    setSent(false)
  }

  function changeDraft(value) {
    setClusters((current) => current.map((cluster) => cluster.id === activeId ? { ...cluster, draft: value } : cluster))
  }

  function syncComments() {
    setSynced('just now')
    setSent(false)
  }

  function sendReplies() {
    if (!selectedCount) return
    setSent(true)
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><MessageCircle size={17} fill="currentColor" /></span><span>comment relay</span></div>
      <div className="workspace-switcher"><span className="avatar avatar-purple">AK</span><span><strong>Alex Kim</strong><small>Creator workspace</small></span><ChevronDown size={15} /></div>
      <nav className="main-nav"><a className="nav-active"><Inbox size={17} />Reply desk<span className="nav-count">13</span></a><a><Video size={17} />Connected videos</a><a><Check size={17} />Sent replies</a></nav>
      <div className="side-label">WORKSPACE</div>
      <div className="video-mini"><div className="video-thumb"><Play size={15} fill="white" /><span>12:48</span></div><div><strong>Build an MCP server...</strong><small>1 video connected</small></div><MoreHorizontal size={16} /></div>
      <div className="sidebar-bottom"><div className="context-note"><Sparkles size={15} /><span><strong>Context makes replies better</strong><small>Add your FAQ, known fixes, and voice here.</small></span></div><button className="link-button"><CircleHelp size={15} />Help & guidelines</button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div><div className="eyebrow">REPLY DESK / ONE VIDEO</div><h1>Answer the questions<br /><em>that keep coming up.</em></h1></div><div className="top-actions"><button className="secondary-button" onClick={syncComments}><RefreshCw size={15} />Sync comments <span className="sync-time">{synced}</span></button><button className="avatar avatar-purple">AK</button></div></header>

      <section className="video-bar"><div className="video-identity"><div className="video-square"><Video size={20} /></div><div><strong>Build your first MCP server with Node.js</strong><small><span className="live-dot" /> youtube.com/watch?v=mcp-101 <ExternalLink size={12} /></small></div></div><div className="video-stats"><span><strong>{totalQuestions}</strong> questions grouped</span><span><strong>2</strong> answer packs ready</span></div></section>

      <div className="workbench">
        <section className="cluster-rail"><div className="section-heading"><span>ANSWER PACKS</span><span className="muted">{clusters.length}</span></div><div className="pack-intro">Repeated questions, grouped so you can answer once.</div>{clusters.map((cluster) => <button className={`cluster-item ${activeId === cluster.id ? 'cluster-active' : ''}`} key={cluster.id} onClick={() => { setActiveId(cluster.id); setSelected([]); setSent(false) }}><div className="cluster-top"><span className={`priority-dot ${cluster.tone}`} /><strong>{cluster.label}</strong><span className="cluster-count">{cluster.count}</span></div><p>{cluster.summary}</p><div className="cluster-bottom"><span className={`priority ${cluster.tone}`}>{cluster.priority} priority</span><span>{activeId === cluster.id ? 'OPEN' : 'VIEW'}</span></div></button>)}</section>

        <section className="thread-panel"><div className="panel-head"><div><div className="eyebrow">PACK / {active.priority.toUpperCase()} PRIORITY</div><h2>{active.label}</h2></div><span className={`pill ${active.tone}`}>{active.count} similar comments</span></div><div className="rationale"><Sparkles size={15} /><span><strong>Why these are together</strong>{active.summary} The wording and intent match closely enough for one tailored answer.</span></div><div className="thread-list">{active.comments.map((comment) => <article className={`comment ${selected.includes(comment.id) ? 'comment-selected' : ''}`} key={comment.id}><button className={`checkbox ${selected.includes(comment.id) ? 'checked' : ''}`} onClick={() => toggleComment(comment.id)} aria-label={`Select ${comment.name}`}>{selected.includes(comment.id) && <Check size={13} />}</button><div className={`avatar avatar-${comment.id % 3 === 0 ? 'blue' : comment.id % 2 ? 'orange' : 'pink'}`}>{comment.initials}</div><div className="comment-body"><div className="comment-meta"><strong>{comment.name}</strong><span>{comment.time}</span><span className="comment-video">on this video</span></div><p>{comment.text}</p><div className="comment-actions"><span>♡ {comment.likes}</span><button>Open on YouTube <ExternalLink size={11} /></button></div></div></article>)}</div></section>

        <section className="composer-panel"><div className="panel-head composer-head"><div><div className="eyebrow">YOUR REPLY</div><h2>Draft once, send with care.</h2></div><span className="draft-badge"><Sparkles size={13} /> AI DRAFT</span></div><label className="field-label">Replying to <span>{selectedCount} selected {selectedCount === 1 ? 'comment' : 'comments'}</span></label><textarea value={active.draft} onChange={(event) => changeDraft(event.target.value)} /><div className="context-section"><div className="field-label">CONTEXT USED <button className="tiny-button">Edit context <Link2 size={12} /></button></div><div className="context-chips"><span>Known fix</span><span>Creator voice</span><span>Video details</span></div><textarea className="context-input" value={context} onChange={(event) => setContext(event.target.value)} /></div><div className="composer-footer"><span className="character-count">{active.draft.length} / 800</span><button className="send-button" disabled={!selectedCount || sent} onClick={sendReplies}>{sent ? <><Check size={16} />Replies sent</> : <><Send size={16} />Reply selected <span>{selectedCount}</span></>}</button></div>{sent && <div className="success-note"><Check size={15} /> {selectedCount} reply results recorded. Nothing else was sent.</div>}<div className="consent-note">You always choose what gets sent. Comment Relay never auto-replies.</div></section>
      </div>
    </main>
  </div>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
