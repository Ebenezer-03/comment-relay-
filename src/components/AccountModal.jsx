import { Check, LogOut, Video, X } from 'lucide-react'

export default function AccountModal({ creator, liveSession, onClose, onDisconnect }) {
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="account-title">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 id="account-title" style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>Creator Account</h2>
          <button className="tiny-button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button>
        </div>

        {liveSession && creator ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#fafbf8', padding: '12px 14px', borderRadius: 8, border: '1px solid #e7e9e2' }}>
              {creator.avatarUrl ? (
                <img src={creator.avatarUrl} alt="" style={{ width: 44, height: 44, borderRadius: '50%' }} />
              ) : (
                <div className="avatar avatar-purple" style={{ width: 44, height: 44, fontSize: 14 }}>
                  {(creator.channelTitle || creator.email || 'CR').slice(0, 2).toUpperCase()}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={{ display: 'block', fontSize: 14, color: '#1e2022' }}>{creator.channelTitle || 'Connected Creator'}</strong>
                <small style={{ color: '#5e6660', fontSize: 12 }}>{creator.email || 'Google Account'}</small>
              </div>
            </div>

            <div style={{ fontSize: 12, color: '#4a514b', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 12px', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Check size={15} color="#16a34a" />
              <span>YouTube Data API v3 Connected</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <button className="secondary-button" onClick={onDisconnect} style={{ color: '#a84131', borderColor: '#f0d2ca' }}>
                <LogOut size={14} /> Disconnect Channel
              </button>
              <button className="secondary-button" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14, textAlign: 'center', padding: '10px 0' }}>
            <p style={{ margin: 0, fontSize: 13, color: '#5e6660' }}>
              You are viewing demo creator data. Connect your Google account to manage your real YouTube channel's comments.
            </p>
            <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center', gap: 10 }}>
              <a className="connect-button" href={`${import.meta.env.VITE_API_BASE || 'http://localhost:8787'}/api/auth/google`}>
                <Video size={14} style={{ marginRight: 6 }} /> Connect Google
              </a>
              <button className="secondary-button" onClick={onClose}>Dismiss</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
