// Central fetch helper — every request attaches the X-Relay-Session header
// the backend's sessionFor() reads (server/index.js), same as the old
// inline fetch calls in main.jsx did individually. Throws on a non-2xx
// response so callers can just try/catch instead of checking response.ok.
export const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:8787'

export async function apiFetch(path, { session, method = 'GET', body } = {}) {
  const headers = {}
  if (session) headers['X-Relay-Session'] = session
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`)
  return data
}
