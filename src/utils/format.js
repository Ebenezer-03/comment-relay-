export function formatRelative(iso) {
  if (!iso) return 'never synced'
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return `${Math.round(hours / 24)} d ago`
}

// Deterministic avatar color cycle for commenter initials — matches the
// original inline `comment.id % 3 === 0 ? 'blue' : comment.id % 2 ? 'orange' : 'pink'`.
export function avatarTone(id) {
  const numeric = typeof id === 'number' ? id : String(id).split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)
  return numeric % 3 === 0 ? 'blue' : numeric % 2 ? 'orange' : 'pink'
}

// "Alex Kim" -> "AK", used for both the demo persona and a real creator's
// channel title once connected (src/components/Sidebar.jsx, ReplyDesk topbar).
export function initialsFor(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || '?'
}
