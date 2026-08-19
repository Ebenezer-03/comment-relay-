import { useState } from 'react'

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
export default function CategoriesPanel({ categories, loading, error, onSave, onAdd, onDelete, onClose }) {
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
