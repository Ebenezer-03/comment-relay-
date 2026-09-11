import { Bot, Check, ShieldCheck, Sparkles, X } from 'lucide-react'

export default function HelpModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="help-title">
      <div className="modal-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={18} color="#4a942a" />
            <h2 id="help-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Help &amp; Guidelines</h2>
          </div>
          <button className="tiny-button" onClick={onClose} aria-label="Close dialog"><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gap: 16, fontSize: 13, lineHeight: 1.55, color: '#3f4641' }}>
          <section style={{ background: '#f8faf6', padding: '14px 16px', borderRadius: 8, border: '1px solid #e2e8de' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#1e251e', marginBottom: 4 }}>
              <Check size={16} color="#4a942a" />
              <span>How Answer Packs Work</span>
            </div>
            <p style={{ margin: 0, fontSize: 12 }}>
              Comment Relay groups repetitive questions from your video comments using intelligent semantic patterns. When multiple viewers ask for the same fix or link, you draft one tailored reply and batch-send it with one click.
            </p>
          </section>

          <section style={{ background: '#fffbeb', padding: '14px 16px', borderRadius: 8, border: '1px solid #fde68a' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>
              <Bot size={16} color="#d97706" />
              <span>Strands Agent &amp; Surfaced Decisions</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#78350f' }}>
              Our AWS Strands Agent (powered by Amazon Bedrock) autonomously triages comments in the background. High-urgency alerts, bug reports, and sensitive feedback are escalated into your <strong>Surfaced Decisions</strong> banner so human judgment always stays in the loop.
            </p>
          </section>

          <section style={{ background: '#f0fdf4', padding: '14px 16px', borderRadius: 8, border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600, color: '#166534', marginBottom: 4 }}>
              <ShieldCheck size={16} color="#16a34a" />
              <span>Human-in-the-Loop &amp; Safety</span>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: '#14532d' }}>
              Comment Relay will <strong>never</strong> auto-reply without your explicit authorization. You select which comments receive answers, edit drafts freely, and verify every message before it is published to YouTube.
            </p>
          </section>

          <section style={{ padding: '4px 6px', fontSize: 12, color: '#5e6660' }}>
            <strong>YouTube Quota Preservation:</strong> Background sync is throttled and resumable. If your channel reaches Google's daily quota floor, syncing pauses automatically and resumes when your quota window resets.
          </section>
        </div>

        <div style={{ marginTop: 22, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="secondary-button" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  )
}
