import { NavLink, useLocation } from 'react-router-dom'
import { Check, ChevronDown, CircleHelp, Inbox, MessageCircle, MoreHorizontal, Play, Sparkles, Video } from 'lucide-react'
import { useAppState } from '../context/AppState.jsx'
import { formatRelative, initialsFor } from '../utils/format.js'

// Demo persona shown until a real creator connects — was previously
// hardcoded everywhere ("Alex Kim"/"AK") regardless of connection state.
const DEMO_NAME = 'Alex Kim'

export default function Sidebar() {
  const { liveSession, creator, activeVideo, workspaceVideos, videosTotal, totalQuestions, setHelpOpen, setAccountOpen } = useAppState()
  const location = useLocation()
  const onReplyDesk = location.pathname === '/' || location.pathname.startsWith('/reply-desk')

  const displayName = liveSession && creator ? (creator.channelTitle || creator.email || 'Connected creator') : DEMO_NAME
  const initials = initialsFor(displayName)

  return (
    <aside className="sidebar">
      <div className="sidebar-fixed-top">
        <div className="brand"><span className="brand-mark"><MessageCircle size={17} fill="currentColor" /></span><span>comment relay</span></div>
        <button className="workspace-switcher" onClick={() => setAccountOpen(true)} style={{ background: 'transparent', width: '100%', textAlign: 'left', cursor: 'pointer' }} title="View account details">
          <span className="avatar avatar-purple">{initials}</span>
          <span style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
            <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</strong>
            <small>{liveSession ? 'Connected' : 'Demo workspace'}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav className="main-nav">
          <NavLink to="/" className={onReplyDesk ? 'nav-active' : ''}><Inbox size={17} />Reply desk<span className="nav-count">{totalQuestions}</span></NavLink>
          <NavLink to="/videos" className={({ isActive }) => isActive ? 'nav-active' : ''}><Video size={17} />Connected videos{liveSession && <span className="nav-count">{videosTotal || workspaceVideos.length}</span>}</NavLink>
          <NavLink to="/sent" className={({ isActive }) => isActive ? 'nav-active' : ''}><Check size={17} />Sent replies</NavLink>
        </nav>
      </div>
      <div className="sidebar-scroll">
        <div className="side-label">WORKSPACE</div>
        {activeVideo
          ? <div className="video-mini"><div className="video-thumb">{activeVideo.thumbnailUrl ? <img src={activeVideo.thumbnailUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Play size={15} fill="white" />}</div><div><strong>{activeVideo.title}</strong><small>Synced {formatRelative(activeVideo.lastSyncedAt)}</small></div><MoreHorizontal size={16} /></div>
          : <div className="video-mini"><div className="video-thumb"><Play size={15} fill="white" /></div><div><strong>{liveSession ? `${videosTotal || workspaceVideos.length} video${(videosTotal || workspaceVideos.length) === 1 ? '' : 's'} connected` : 'Build an MCP server...'}</strong><small>{liveSession ? 'Pick one to reply' : '1 video connected'}</small></div><MoreHorizontal size={16} /></div>}
      </div>
      <div className="sidebar-bottom">
        <div className="context-note">
          <Sparkles size={15} />
          <span><strong>Context makes replies better</strong><small>Add your FAQ, known fixes, and voice here.</small></span>
        </div>
        <button className="link-button" onClick={() => setHelpOpen(true)} title="View guidelines and instructions">
          <CircleHelp size={15} />Help &amp; guidelines
        </button>
      </div>
    </aside>
  )
}
