// Shared app state, lifted out of the old single `App` component so routed
// pages (src/pages/*) and the sidebar can all read/act on the same
// workspace — videos, categories, and whichever video's reply desk is open
// — without prop-drilling across routes. Behavior matches the pre-router
// main.jsx as closely as possible; new bits (pagination, context notes, the
// two AI actions, creator identity) are called out inline.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api.js'
import { demoClusters } from '../data/demoClusters.js'

const AppStateContext = createContext(null)

export function AppStateProvider({ children }) {
  const [liveSession, setLiveSession] = useState(() => sessionStorage.getItem('comment-relay-session') || '')
  const [configured, setConfigured] = useState(true)
  // Real signed-in identity (channelTitle/email) once connected — replaces
  // the frontend's previous hardcoded "Alex Kim"/"AK".
  const [creator, setCreator] = useState(null)

  const [workspaceVideos, setWorkspaceVideos] = useState([])
  const [videosTotal, setVideosTotal] = useState(0)
  const [videosOffset, setVideosOffset] = useState(0)
  const videosLimit = 20
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [syncJob, setSyncJob] = useState(null)

  const [categories, setCategories] = useState([])
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [categoriesLoading, setCategoriesLoading] = useState(false)
  const [categoriesError, setCategoriesError] = useState('')

  const [activeVideo, setActiveVideo] = useState(null)
  const [videoLoading, setVideoLoading] = useState(false)
  const [clusters, setClusters] = useState(demoClusters)
  const [activeId, setActiveId] = useState('install')
  const [selected, setSelected] = useState([1, 2])
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState('')
  const [reclassifying, setReclassifying] = useState(false)
  const [draftGenerating, setDraftGenerating] = useState(false)
  const [aiError, setAiError] = useState('')

  // Clear selections whenever the active cluster changes to avoid phantom selections
  useEffect(() => {
    setSelected([])
    setSent(false)
    setSendError('')
  }, [activeId])

  useEffect(() => {
    const session = new URLSearchParams(window.location.search).get('session')
    if (session) {
      sessionStorage.setItem('comment-relay-session', session)
      setLiveSession(session)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [])

  const refreshAuthStatus = useCallback(async () => {
    try {
      const data = await apiFetch('/api/auth/status', { session: liveSession })
      setConfigured(data.configured)
      setCreator(data.connected ? data.creator : null)
      if (liveSession && !data.connected) {
        // Session expired/invalid server-side — drop it locally too instead
        // of showing a connected UI backed by a dead session.
        sessionStorage.removeItem('comment-relay-session')
        setLiveSession('')
      }
    } catch {
      // Transient failure — leave whatever we already knew in place.
    }
  }, [liveSession])

  useEffect(() => { refreshAuthStatus() }, [refreshAuthStatus])

  const loadWorkspaceVideos = useCallback(async (offset = 0) => {
    setWorkspaceLoading(true)
    setWorkspaceError('')
    try {
      const data = await apiFetch(`/api/videos?limit=${videosLimit}&offset=${offset}`, { session: liveSession })
      setWorkspaceVideos(data.videos || [])
      setVideosTotal(data.total ?? (data.videos || []).length)
      setVideosOffset(offset)
    } catch (error) {
      setWorkspaceError(error.message)
    }
    setWorkspaceLoading(false)
  }, [liveSession])

  const loadCategories = useCallback(async () => {
    setCategoriesLoading(true)
    setCategoriesError('')
    try {
      const data = await apiFetch('/api/categories', { session: liveSession })
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
    setCategoriesLoading(false)
  }, [liveSession])

  useEffect(() => {
    if (liveSession) {
      loadWorkspaceVideos(0)
      loadCategories()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSession])

  // Guards against overlapping /api/videos/sync bursts — two bursts racing
  // on the same job's cursor would step on each other's progress.
  const syncInFlightRef = useRef(false)

  const syncWorkspaceVideos = useCallback(async () => {
    if (syncInFlightRef.current) return
    syncInFlightRef.current = true
    setWorkspaceSyncing(true)
    setWorkspaceError('')
    try {
      const data = await apiFetch('/api/videos/sync', { method: 'POST', session: liveSession })
      setSyncJob(data.job)
      // A sync round can reshuffle priority order — refresh whichever page
      // was showing rather than trusting the (unpaginated) sync response.
      await loadWorkspaceVideos(videosOffset)
    } catch (error) {
      setWorkspaceError(error.message)
    }
    syncInFlightRef.current = false
    setWorkspaceSyncing(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSession, videosOffset])

  // Reads job progress without triggering a burst. GET /api/videos/sync/status
  // has existed since sync became resumable but nothing ever called it — the
  // frontend re-POSTed the expensive burst endpoint just to learn the status,
  // and a job the cron started was invisible until the creator clicked Sync.
  const refreshSyncStatus = useCallback(async () => {
    if (!liveSession) return null
    try {
      const data = await apiFetch('/api/videos/sync/status', { session: liveSession })
      setSyncJob(data.job)
      return data.job
    } catch {
      return null // transient; the next tick will try again
    }
  }, [liveSession])

  // Pick up a job already in flight (started by the cron, or by this creator
  // in another tab) as soon as the workspace loads.
  useEffect(() => { refreshSyncStatus() }, [refreshSyncStatus])

  // A single sync click only advances the job for ~20s server-side — large
  // channels need more turns.
  //
  // 'running'      -> keep triggering the next burst so the creator doesn't
  //                   have to keep clicking.
  // 'paused_quota' -> do NOT burst (it would just be refused); poll status
  //                   instead. This case used to fall out of the effect
  //                   entirely, freezing the progress bar until a manual
  //                   click, even after the cron had resumed the job.
  useEffect(() => {
    const status = syncJob?.status
    if (!liveSession || (status !== 'running' && status !== 'paused_quota')) return
    const advancing = status === 'running'
    const interval = setInterval(async () => {
      if (advancing) return syncWorkspaceVideos()
      const job = await refreshSyncStatus()
      // Quota freed up and something else restarted us — reload the list so
      // newly-ranked videos appear.
      if (job?.status === 'running' || job?.status === 'done') loadWorkspaceVideos(videosOffset)
    }, advancing ? 4000 : 30000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveSession, syncJob?.status])

  async function saveCategory(packId, fields) {
    setCategoriesError('')
    try {
      const data = await apiFetch(`/api/categories/${packId}`, { method: 'PUT', session: liveSession, body: fields })
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
  }

  async function addCategory(fields) {
    setCategoriesError('')
    try {
      const data = await apiFetch('/api/categories', { method: 'POST', session: liveSession, body: fields })
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
  }

  async function deleteCategory(packId) {
    setCategoriesError('')
    try {
      const data = await apiFetch(`/api/categories/${packId}`, { method: 'DELETE', session: liveSession })
      setCategories(data.categories || [])
    } catch (error) {
      setCategoriesError(error.message)
    }
  }

  async function openVideo(videoId) {
    if (activeVideo?.id === videoId) return
    setVideoLoading(true)
    setWorkspaceError('')
    setAiError('')
    try {
      const data = await apiFetch(`/api/videos/${videoId}`, { session: liveSession })
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

  function toggleComment(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
    setSent(false)
  }

  function changeDraft(value) {
    setClusters((current) => current.map((cluster) => cluster.id === activeId ? { ...cluster, draft: value } : cluster))
  }

  function changeContext(value) {
    setClusters((current) => current.map((cluster) => cluster.id === activeId ? { ...cluster, context: value } : cluster))
  }

  const active = clusters.find((cluster) => cluster.id === activeId)

  async function saveDraft() {
    if (!liveSession || !activeVideo || !active) return
    try {
      await apiFetch(`/api/videos/${activeVideo.id}/packs/${activeId}`, { method: 'PUT', session: liveSession, body: { draft: active.draft } })
    } catch {
      // Non-fatal: the draft still lives in local state even if the save fails.
    }
  }

  // Persists the "context used" note (server/db/schema.js: answerPacks.context)
  // — this used to be local-only React state that reset on every reload.
  async function saveContext() {
    if (!liveSession || !activeVideo || !active) return
    try {
      await apiFetch(`/api/videos/${activeVideo.id}/packs/${activeId}`, { method: 'PUT', session: liveSession, body: { context: active.context || '' } })
    } catch {
      // Non-fatal, same as saveDraft.
    }
  }

  async function sendReplies() {
    if (!selectedCount) return
    setSendError('')
    if (liveSession && activeVideo) {
      try {
        const data = await apiFetch('/api/replies', {
          method: 'POST',
          session: liveSession,
          body: { videoId: activeVideo.id, parentIds: selectedComments.map((comment) => comment.parentId || comment.id), text: active.draft },
        })
        const failures = data.results?.filter((result) => !result.ok) || []
        if (failures.length) throw new Error(`${failures.length} selected repl${failures.length === 1 ? 'y' : 'ies'} failed to send.`)
      } catch (error) {
        setSendError(error.message)
        return
      }
    }
    setSent(true)
  }

  // Re-buckets the open video's comments with the AI Gateway instead of the
  // plain keyword classifier (server/ai.js, POST /api/videos/:id/reclassify)
  // — an explicit upgrade for niches the default keyword rules miss.
  async function reclassifyWithAI() {
    if (!liveSession || !activeVideo) return
    setReclassifying(true)
    setAiError('')
    try {
      const data = await apiFetch(`/api/videos/${activeVideo.id}/reclassify`, { method: 'POST', session: liveSession })
      setClusters(data.clusters)
      if (!data.clusters.some((cluster) => cluster.id === activeId)) setActiveId(data.clusters[0]?.id || '')
      setSelected([])
      setSent(false)
    } catch (error) {
      setAiError(error.message)
    }
    setReclassifying(false)
  }

  // Generates (and saves) a draft for the open pack via the AI Gateway
  // (server/ai.js, POST /api/videos/:id/packs/:packId/draft/generate) —
  // makes the composer's "AI DRAFT" badge describe something real.
  async function generateDraft() {
    if (!liveSession || !activeVideo || !active) return
    setDraftGenerating(true)
    setAiError('')
    try {
      const data = await apiFetch(`/api/videos/${activeVideo.id}/packs/${activeId}/draft/generate`, { method: 'POST', session: liveSession })
      setClusters((current) => current.map((cluster) => cluster.id === activeId ? { ...cluster, draft: data.draft } : cluster))
    } catch (error) {
      setAiError(error.message)
    }
    setDraftGenerating(false)
  }

  const selectedCount = active ? active.comments.filter((comment) => selected.includes(comment.id)).length : 0
  // "Questions" = everything that isn't low-priority chatter. Keyed off the
  // category's own priority rather than the literal pack id 'praise', which
  // only existed in the default category set — a creator who renamed or
  // replaced it had their praise counted as questions.
  const totalQuestions = clusters.reduce((sum, cluster) => sum + (cluster.priority === 'Low' ? 0 : cluster.count), 0)
  const selectedComments = active ? active.comments.filter((comment) => selected.includes(comment.id)) : []

  const value = {
    liveSession, configured, creator,
    workspaceVideos, videosTotal, videosOffset, videosLimit, workspaceLoading, workspaceSyncing, workspaceError, syncJob,
    loadWorkspaceVideos, syncWorkspaceVideos, refreshSyncStatus,
    categories, categoriesOpen, setCategoriesOpen, categoriesLoading, categoriesError, saveCategory, addCategory, deleteCategory,
    activeVideo, videoLoading, clusters, active, activeId, setActiveId, selected, setSelected, sent, sendError,
    openVideo, backToWorkspace, toggleComment, changeDraft, saveDraft, changeContext, saveContext, sendReplies,
    selectedCount, totalQuestions, selectedComments,
    reclassifyWithAI, reclassifying, generateDraft, draftGenerating, aiError,
  }

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider')
  return ctx
}
