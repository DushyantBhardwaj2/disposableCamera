import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://disposable-camera-api.onrender.com"
const DEV_FALLBACK_QR_TOKEN = 'BALODHI-QR-2026'
const COMMENT_PAGE_SIZE = 30

const parseTokenFromPath = (pathname) => {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 2 && parts[0] === 'f') {
    return decodeURIComponent(parts[1])
  }
  return ''
}

const isAdminRoute = (pathname) => pathname.startsWith('/admin/moderation')
const isGalleryRoute = (pathname) => pathname.startsWith('/gallery')
const isScanRoute = (pathname) => pathname.startsWith('/scan')
const isIntroRoute = (pathname) => pathname === '/'

const getStoredValue = (key) => {
  return window.sessionStorage.getItem(key) || window.localStorage.getItem(key) || ''
}

const setStoredValue = (key, value) => {
  window.sessionStorage.setItem(key, value)
  window.localStorage.setItem(key, value)
}

const clearStoredValue = (key) => {
  window.sessionStorage.removeItem(key)
  window.localStorage.removeItem(key)
}

const fetchWithTimeout = async (url, options = {}, timeoutMs = 12000) => {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

const UploadProgressList = memo(function UploadProgressList({ jobs }) {
  if (!jobs.length) {
    return null
  }

  return (
    <ul className="upload-progress-list">
      {jobs.map((job) => (
        <li key={job.id} className={`upload-job upload-job--${job.status}`}>
          <span className="upload-job-name">{job.name}</span>
          <span className="upload-job-status">
            {job.status === 'pending' && 'Waiting'}
            {job.status === 'uploading' && 'Uploading…'}
            {job.status === 'done' && 'Done'}
            {job.status === 'error' && `Failed: ${job.error}`}
          </span>
        </li>
      ))}
    </ul>
  )
})

const GalleryLightbox = memo(function GalleryLightbox({ url, onClose }) {
  if (!url) {
    return null
  }

  return (
    <div className="lightbox" onClick={onClose}>
      <button className="lightbox-close" onClick={onClose} aria-label="Close">✕</button>
      <img src={url} alt="Full size" className="lightbox-img" draggable={false} />
    </div>
  )
})

const PendingPhotoItem = memo(function PendingPhotoItem({ item, isSelected, onToggleSelect, onModerate, onPreview }) {
  const url = item.filtered_url || item.original_url
  return (
    <article className="moderation-item">
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(event) => onToggleSelect(item.id, event.target.checked)}
        />
        Photo #{item.id}
      </label>
      <p className="hint">
        {item.family_name} {item.guest_name ? `• ${item.guest_name}` : ''}
      </p>
      {url ? (
        <button
          className="mod-thumb-btn"
          onClick={() => onPreview(url)}
          aria-label={`Preview photo ${item.id} full size`}
          type="button"
        >
          <img
            src={url}
            alt="pending photo thumbnail"
            className="mod-thumb"
            loading="lazy"
            onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }}
            draggable={false}
          />
          <span className="mod-thumb-overlay" aria-hidden="true">View full size</span>
        </button>
      ) : (
        <div className="mod-thumb mod-thumb-empty" />
      )}
      <div className="admin-actions">
        <button className="primary small" onClick={() => onModerate(item.id, 'approve')}>Approve</button>
        <button className="danger small" onClick={() => onModerate(item.id, 'reject')}>Reject</button>
      </div>
    </article>
  )
})

const ApprovedPhotoItem = memo(function ApprovedPhotoItem({ item, onDelete, onPreview }) {
  const url = item.filtered_url || item.original_url
  return (
    <article className="moderation-item">
      <p className="hint">
        #{item.id} {item.family_name} {item.guest_name ? `• ${item.guest_name}` : ''}
      </p>
      {url ? (
        <button
          className="mod-thumb-btn"
          onClick={() => onPreview(url)}
          aria-label={`Preview photo ${item.id} full size`}
          type="button"
        >
          <img
            src={url}
            alt="approved photo"
            className="mod-thumb"
            loading="lazy"
            onError={(e) => { e.currentTarget.parentElement.style.display = 'none' }}
            draggable={false}
          />
          <span className="mod-thumb-overlay" aria-hidden="true">View full size</span>
        </button>
      ) : (
        <div className="mod-thumb mod-thumb-empty" />
      )}
      <div className="admin-actions">
        <button className="danger small" onClick={() => onDelete(item.id)}>Delete from Gallery</button>
      </div>
    </article>
  )
})

function App() {
  const pathname = window.location.pathname
  const adminMode = useMemo(() => isAdminRoute(pathname), [pathname])
  const galleryMode = useMemo(() => isGalleryRoute(pathname), [pathname])
  const scanMode = useMemo(() => isScanRoute(pathname), [pathname])
  const introMode = useMemo(() => isIntroRoute(pathname), [pathname])
  const token = useMemo(() => parseTokenFromPath(pathname), [pathname])

  const [sessionToken, setSessionToken] = useState(() => getStoredValue('guest_session_token'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminToken, setAdminToken] = useState(() => getStoredValue('admin_token'))
  const [pendingItems, setPendingItems] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [adminMessage, setAdminMessage] = useState('')
  const [telemetryCounters, setTelemetryCounters] = useState([])
  const [telemetryGroups, setTelemetryGroups] = useState({ route_hits: [], latency_buckets: [], client_events: [], other: [] })
  const [telemetryTotals, setTelemetryTotals] = useState({ route_hits: 0, latency_events: 0, client_events: 0, other_events: 0 })
  const [healthSnapshot, setHealthSnapshot] = useState(null)
  const [opsChecks, setOpsChecks] = useState([])
  const [opsChecksSummary, setOpsChecksSummary] = useState(null)
  const [runningOpsChecks, setRunningOpsChecks] = useState(false)
  const [diagCaptureRaw, setDiagCaptureRaw] = useState(false)
  const [adminFamilies, setAdminFamilies] = useState([])
  const [uploadEnabled, setUploadEnabled] = useState(true)
  const [galleryItems, setGalleryItems] = useState([])
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [galleryMessage, setGalleryMessage] = useState('')
  const [galleryLoading, setGalleryLoading] = useState(false)
  const [galleryLimit, setGalleryLimit] = useState(80)
  const [galleryOffset, setGalleryOffset] = useState(0)
  const [galleryTotal, setGalleryTotal] = useState(0)
  const dragOriginRef = useRef(null)
  const wasDragRef = useRef(false)
  const [dragX, setDragX] = useState(null)
  const [flyDir, setFlyDir] = useState(null)
  const [brokenPhotoIds, setBrokenPhotoIds] = useState([])
  const [drawerPhotoId, setDrawerPhotoId] = useState(null)
  const [comments, setComments] = useState({})
  const [commentOffsets, setCommentOffsets] = useState({})
  const [commentTotals, setCommentTotals] = useState({})
  const [commentLoading, setCommentLoading] = useState({})
  const [commentText, setCommentText] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [uploadJobs, setUploadJobs] = useState([])
  const [newFamilyName, setNewFamilyName] = useState('')
  const [newFamilySlug, setNewFamilySlug] = useState('')
  const [newFamilyToken, setNewFamilyToken] = useState('')
  const [creatingFamily, setCreatingFamily] = useState(false)
  const [approvedItems, setApprovedItems] = useState([])
  const [adminSection, setAdminSection] = useState('approve')
  const [adminSearch, setAdminSearch] = useState('')
  const [adminFamilyFilter, setAdminFamilyFilter] = useState('0')
  const [adminFromDate, setAdminFromDate] = useState('')
  const [adminToDate, setAdminToDate] = useState('')
  const [adminLimit, setAdminLimit] = useState(50)
  const [pendingOffset, setPendingOffset] = useState(0)
  const [approvedOffset, setApprovedOffset] = useState(0)
  const [pendingTotal, setPendingTotal] = useState(0)
  const [approvedTotal, setApprovedTotal] = useState(0)
  const [swipeHintSeen, setSwipeHintSeen] = useState(() => !!getStoredValue('swipe_hint_seen'))
  const [manualToken, setManualToken] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [scannerBusy, setScannerBusy] = useState(false)

  const videoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const scannerLoopRef = useRef(null)
  const scannerInFlightRef = useRef(false)
  const scannerBusyRef = useRef(false)
  const galleryRequestInFlightRef = useRef(false)
  const galleryPollTimerRef = useRef(null)
  const galleryPollFailureCountRef = useRef(0)
  const firstGalleryLoadRef = useRef(true)
  const dragRafRef = useRef(null)
  const pendingDragXRef = useRef(0)
  const commentsCacheRef = useRef({})
  const uploadFilesRef = useRef(new Map())

  useEffect(() => {
    scannerBusyRef.current = scannerBusy
  }, [scannerBusy])

  useEffect(() => {
    commentsCacheRef.current = comments
  }, [comments])

  useEffect(() => {
    // Warm up Render on first page load to reduce cold-start delay for user actions.
    fetch(`${API_BASE_URL}/api/health`).catch(() => {})
  }, [])

  const topRibbon = (
    <nav className="top-ribbon">
      <div className="top-ribbon-inner">
        <a className={`top-ribbon-link ${introMode ? 'active' : ''}`} href="/">Home</a>
        <a className={`top-ribbon-link ${scanMode ? 'active' : ''}`} href="/scan">Scan</a>
        <a className={`top-ribbon-link ${galleryMode ? 'active' : ''}`} href="/gallery">Gallery</a>
        {adminMode ? <a className="top-ribbon-link active" href="/admin/moderation">Admin</a> : null}
      </div>
    </nav>
  )

  const navigate = (to) => {
    if (window.location.pathname === to) {
      return
    }
    window.location.assign(to)
  }

  const handleAdminAuthFailure = useCallback((data, fallbackMessage) => {
    const code = String(data?.error || '').trim()
    if (code === 'invalid_admin' || code === 'missing_admin') {
      clearStoredValue('admin_token')
      setAdminToken('')
      setAdminMessage('Admin session expired. Please login again.')
      return true
    }
    setAdminMessage(data?.message || fallbackMessage)
    return false
  }, [])

  const logClientTelemetry = useCallback((eventName, details = {}) => {
    fetch(`${API_BASE_URL}/api/telemetry/client`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: String(eventName || ''), details }),
    }).catch(() => {})
  }, [])

  const bootstrapFromQrToken = useCallback(async (qrToken, redirectToGallery = false) => {
    const trimmedToken = String(qrToken || '').trim()
    if (!trimmedToken) {
      throw new Error('Please provide a family token')
    }

    const validateResponse = await fetch(`${API_BASE_URL}/api/token/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qr_token: trimmedToken }),
    })

    const validateData = await validateResponse.json()
    if (!validateResponse.ok) {
      throw new Error(validateData?.message || 'Invalid family token')
    }

    const startResponse = await fetch(`${API_BASE_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qr_token: trimmedToken, guest_name: '' }),
    })
    const startData = await startResponse.json()
    if (!startResponse.ok || !startData?.session_token) {
      throw new Error(startData?.message || 'Could not start session')
    }

    setSessionToken(startData.session_token)
    setStoredValue('family_qr_token', trimmedToken)
    setStoredValue('guest_session_token', startData.session_token)

    if (redirectToGallery) {
      navigate('/gallery')
    }

    return startData.session_token
  }, [])

  const bootstrapSessionFromSavedToken = useCallback(async () => {
    const savedQrToken = getStoredValue('family_qr_token') || (import.meta.env.DEV ? DEV_FALLBACK_QR_TOKEN : '')
    if (!savedQrToken) {
      return null
    }
    try {
      return await bootstrapFromQrToken(savedQrToken, false)
    } catch {
      return null
    }
  }, [bootstrapFromQrToken])

  const loadPending = useCallback(async (tokenValue, offsetOverride) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }

    const nextOffset = Number.isFinite(offsetOverride) ? Math.max(0, Number(offsetOverride)) : pendingOffset
    const params = new URLSearchParams({
      limit: String(adminLimit),
      offset: String(nextOffset),
    })
    const trimmedSearch = adminSearch.trim()
    const familyIdValue = Number(adminFamilyFilter || 0)
    if (trimmedSearch) {
      params.set('search', trimmedSearch)
    }
    if (Number.isFinite(familyIdValue) && familyIdValue > 0) {
      params.set('family_id', String(familyIdValue))
    }
    if (adminFromDate) {
      params.set('from', adminFromDate)
    }
    if (adminToDate) {
      params.set('to', adminToDate)
    }

    const response = await fetch(`${API_BASE_URL}/api/admin/photos/pending?${params.toString()}`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Failed to load pending photos')) {
        return
      }
      throw new Error(data?.message || 'Failed to load pending photos')
    }
    setPendingItems(data.items || [])
    setPendingOffset(Number(data.offset || 0))
    setPendingTotal(Number(data.total || 0))
  }, [adminToken, handleAdminAuthFailure, pendingOffset, adminLimit, adminSearch, adminFamilyFilter, adminFromDate, adminToDate])

  const loadApproved = useCallback(async (tokenValue, offsetOverride) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }

    const nextOffset = Number.isFinite(offsetOverride) ? Math.max(0, Number(offsetOverride)) : approvedOffset
    const params = new URLSearchParams({
      limit: String(adminLimit),
      offset: String(nextOffset),
    })
    const trimmedSearch = adminSearch.trim()
    const familyIdValue = Number(adminFamilyFilter || 0)
    if (trimmedSearch) {
      params.set('search', trimmedSearch)
    }
    if (Number.isFinite(familyIdValue) && familyIdValue > 0) {
      params.set('family_id', String(familyIdValue))
    }
    if (adminFromDate) {
      params.set('from', adminFromDate)
    }
    if (adminToDate) {
      params.set('to', adminToDate)
    }

    const response = await fetch(`${API_BASE_URL}/api/admin/photos/approved?${params.toString()}`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Failed to load approved photos')) {
        return
      }
      throw new Error(data?.message || 'Failed to load approved photos')
    }
    setApprovedItems(data.items || [])
    setApprovedOffset(Number(data.offset || 0))
    setApprovedTotal(Number(data.total || 0))
  }, [adminToken, handleAdminAuthFailure, approvedOffset, adminLimit, adminSearch, adminFamilyFilter, adminFromDate, adminToDate])

  const loadAdminFamilies = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/families`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Unable to load families')) {
        return
      }
      setAdminMessage(data?.message || 'Unable to load families')
      return
    }
    setAdminFamilies(Array.isArray(data.families) ? data.families : [])
  }, [adminToken, handleAdminAuthFailure])

  const loadHealthSnapshot = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/health-snapshot`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Unable to load health snapshot')) {
        return
      }
      setAdminMessage(data?.message || 'Unable to load health snapshot')
      return
    }
    setHealthSnapshot(data)
  }, [adminToken, handleAdminAuthFailure])

  const runOpsChecks = useCallback(async (options = {}) => {
    if (!adminToken || runningOpsChecks) {
      return
    }

    const onlyChecks = Array.isArray(options.onlyChecks) ? options.onlyChecks : []
    const captureRaw = options.captureRaw !== undefined ? Boolean(options.captureRaw) : diagCaptureRaw

    setRunningOpsChecks(true)
    setOpsChecksSummary(null)
    const results = []
    const startedAt = Date.now()

    const runCheck = async (name, run) => {
      try {
        const result = await run()
        const isObj = result !== null && typeof result === 'object'
        const detail = isObj ? String(result.detail || 'ok') : String(result || 'ok')
        const rawData = isObj ? result.raw : undefined
        results.push({ name, ok: true, detail, ...(captureRaw && rawData !== undefined ? { raw: rawData } : {}) })
      } catch (checkError) {
        results.push({ name, ok: false, detail: String(checkError?.message || 'failed') })
      }
    }

    const checks = [
      {
        name: 'API health',
        run: async () => {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, {}, 9000)
          const data = await response.json()
          if (!response.ok || data?.status !== 'ok') {
            throw new Error(data?.message || `status ${response.status}`)
          }
          return { detail: 'service ok', raw: data }
        },
      },
      {
        name: 'Admin token check',
        run: async () => {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/admin/upload-toggle`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          }, 9000)
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data?.message || `status ${response.status}`)
          }
          return { detail: `uploads ${data.upload_enabled ? 'enabled' : 'disabled'}`, raw: data }
        },
      },
      {
        name: 'Pending list query',
        run: async () => {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/admin/photos/pending?limit=1&offset=0`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          }, 9000)
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data?.message || `status ${response.status}`)
          }
          return { detail: `total ${Number(data?.total || 0)}`, raw: { total: data?.total } }
        },
      },
      {
        name: 'Telemetry endpoint',
        run: async () => {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/admin/telemetry/summary`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          }, 9000)
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data?.message || `status ${response.status}`)
          }
          return { detail: `events ${Array.isArray(data?.counters) ? data.counters.length : 0}`, raw: { now: data?.now, totals: data?.totals } }
        },
      },
      {
        name: 'Health snapshot endpoint',
        run: async () => {
          const response = await fetchWithTimeout(`${API_BASE_URL}/api/admin/health-snapshot`, {
            headers: { Authorization: `Bearer ${adminToken}` },
          }, 9000)
          const data = await response.json()
          if (!response.ok) {
            throw new Error(data?.message || `status ${response.status}`)
          }
          return { detail: `db ${data?.status?.db_ok ? 'ok' : 'issue'}`, raw: data?.status }
        },
      },
    ]

    const checksToRun = onlyChecks.length ? checks.filter((check) => onlyChecks.includes(check.name)) : checks
    if (checksToRun.length === 0) {
      setAdminMessage('No matching checks to run')
      setRunningOpsChecks(false)
      return
    }

    for (const check of checksToRun) {
      await runCheck(check.name, check.run)
    }

    const sortedResults = [...results].sort((a, b) => Number(a.ok) - Number(b.ok))
    setOpsChecks(sortedResults)

    // Refresh live operational cards after sweep so panel reflects latest server state.
    await Promise.all([
      loadTelemetrySummary(adminToken),
      loadHealthSnapshot(adminToken),
      loadUploadToggle(adminToken),
    ])

    const finishedAt = Date.now()
    const failedCount = results.filter((item) => !item.ok).length
    const totalCount = results.length
    const passedCount = totalCount - failedCount
    setOpsChecksSummary({
      total: totalCount,
      passed: passedCount,
      failed: failedCount,
      duration_ms: finishedAt - startedAt,
      completed_at: new Date().toISOString(),
      scope: onlyChecks.length ? 'retry' : 'full',
    })
    const sweepLabel = onlyChecks.length ? 'Retry sweep' : 'Ops sweep'
    setAdminMessage(failedCount ? `${sweepLabel}: ${failedCount}/${totalCount} failed` : `${sweepLabel} passed`)
    setRunningOpsChecks(false)
  }, [adminToken, runningOpsChecks, diagCaptureRaw, loadTelemetrySummary, loadHealthSnapshot, loadUploadToggle])

  const failedOpsChecks = useMemo(() => opsChecks.filter((check) => !check.ok).map((check) => check.name), [opsChecks])

  const retryFailedOpsChecks = useCallback(async () => {
    if (failedOpsChecks.length === 0) {
      setAdminMessage('No failed checks to retry')
      return
    }
    await runOpsChecks({ onlyChecks: failedOpsChecks })
  }, [failedOpsChecks, runOpsChecks])

  const buildOpsDiagnostics = useCallback(() => {
    const rawResponses = opsChecks.some((c) => c.raw !== undefined)
      ? Object.fromEntries(opsChecks.filter((c) => c.raw !== undefined).map((c) => [c.name, c.raw]))
      : undefined
    return {
      generated_at: new Date().toISOString(),
      api_base_url: API_BASE_URL,
      ops_summary: opsChecksSummary,
      checks: opsChecks.map((c) => ({ name: c.name, ok: c.ok, detail: c.detail })),
      telemetry_totals: telemetryTotals,
      telemetry_groups: telemetryGroups,
      health_snapshot: healthSnapshot,
      upload_enabled: uploadEnabled,
      pending_count: pendingItems.length,
      approved_count: approvedItems.length,
      ...(rawResponses ? { raw_endpoint_responses: rawResponses } : {}),
    }
  }, [opsChecksSummary, opsChecks, telemetryTotals, telemetryGroups, healthSnapshot, uploadEnabled, pendingItems.length, approvedItems.length])

  const copyDiagnostics = useCallback(async () => {
    const payload = JSON.stringify(buildOpsDiagnostics(), null, 2)

    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(payload)
        setAdminMessage('Diagnostics JSON copied to clipboard')
        return
      } catch {
        // Fall through to textarea fallback.
      }
    }

    const fallback = document.createElement('textarea')
    fallback.value = payload
    fallback.setAttribute('readonly', 'true')
    fallback.style.position = 'fixed'
    fallback.style.opacity = '0'
    document.body.appendChild(fallback)
    fallback.select()
    const copied = document.execCommand('copy')
    document.body.removeChild(fallback)

    setAdminMessage(copied ? 'Diagnostics JSON copied to clipboard' : 'Unable to copy diagnostics JSON')
  }, [buildOpsDiagnostics])

  const exportDiagnostics = useCallback(() => {
    const payload = JSON.stringify(buildOpsDiagnostics(), null, 2)
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `ops-diagnostics-${Date.now()}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
    setAdminMessage('Diagnostics JSON exported')
  }, [buildOpsDiagnostics])

  const resetTelemetry = useCallback(async () => {
    if (!adminToken) {
      return
    }
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/telemetry/reset`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401 && handleAdminAuthFailure(data, 'Unable to reset telemetry')) {
          return
        }
        setAdminMessage(data?.message || 'Unable to reset telemetry')
        return
      }
      setAdminMessage(`Telemetry reset — cleared ${Number(data.cleared || 0)} counters`)
      await loadTelemetrySummary(adminToken)
    } catch {
      setAdminMessage('Telemetry reset failed')
    }
  }, [adminToken, handleAdminAuthFailure, loadTelemetrySummary])

  const applyAdminDatePreset = useCallback((preset) => {
    const now = new Date()
    const toIsoDate = (value) => value.toISOString().slice(0, 10)

    if (preset === 'today') {
      const today = toIsoDate(now)
      setAdminFromDate(today)
      setAdminToDate(today)
      return
    }

    if (preset === 'last7') {
      const from = new Date(now)
      from.setDate(from.getDate() - 6)
      setAdminFromDate(toIsoDate(from))
      setAdminToDate(toIsoDate(now))
      return
    }

    setAdminFromDate('')
    setAdminToDate('')
  }, [])

  const clearAdminFilters = useCallback(() => {
    setAdminSearch('')
    setAdminFamilyFilter('0')
    setAdminFromDate('')
    setAdminToDate('')
    setSelectedIds([])
  }, [])

  const loadUploadToggle = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/upload-toggle`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Unable to load upload toggle')) {
        return
      }
      return
    }
    setUploadEnabled(Boolean(data.upload_enabled))
  }, [adminToken, handleAdminAuthFailure])

  const loadTelemetrySummary = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/telemetry/summary`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Unable to load telemetry summary')) {
        return
      }
      setAdminMessage(data?.message || 'Unable to load telemetry summary')
      return
    }
    setTelemetryCounters(Array.isArray(data.counters) ? data.counters : [])
    const groups = data?.groups && typeof data.groups === 'object' ? data.groups : {}
    setTelemetryGroups({
      route_hits: Array.isArray(groups.route_hits) ? groups.route_hits : [],
      latency_buckets: Array.isArray(groups.latency_buckets) ? groups.latency_buckets : [],
      client_events: Array.isArray(groups.client_events) ? groups.client_events : [],
      other: Array.isArray(groups.other) ? groups.other : [],
    })
    const totals = data?.totals && typeof data.totals === 'object' ? data.totals : {}
    setTelemetryTotals({
      route_hits: Number(totals.route_hits || 0),
      latency_events: Number(totals.latency_events || 0),
      client_events: Number(totals.client_events || 0),
      other_events: Number(totals.other_events || 0),
    })
  }, [adminToken, handleAdminAuthFailure])

  const adminLogin = async () => {
    setAdminMessage('')
    const response = await fetch(`${API_BASE_URL}/api/admin/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: adminPassword }),
    })
    const data = await response.json()
    if (!response.ok) {
      setAdminMessage(data?.message || 'Login failed')
      return
    }
    setAdminToken(data.admin_token)
    setStoredValue('admin_token', data.admin_token)
    await Promise.all([
      loadPending(data.admin_token, 0),
      loadUploadToggle(data.admin_token),
      loadApproved(data.admin_token, 0),
      loadTelemetrySummary(data.admin_token),
      loadAdminFamilies(data.admin_token),
      loadHealthSnapshot(data.admin_token),
    ])
    setAdminMessage('Admin login successful')
  }

  const moderateOne = useCallback(async (photoId, action) => {
    if (!adminToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/photos/${photoId}/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_token: adminToken }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, `Failed to ${action} photo`)) {
        return
      }
      setAdminMessage(data?.message || `Failed to ${action} photo`)
      return
    }
    setPendingItems((items) => items.filter((x) => x.id !== photoId))
    setPendingTotal((total) => Math.max(0, total - 1))
    setSelectedIds((ids) => ids.filter((x) => x !== photoId))
    setAdminMessage(`Photo ${action}d`)
  }, [adminToken, handleAdminAuthFailure])

  const bulkApprove = async () => {
    if (!adminToken || !selectedIds.length) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/photos/bulk-approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_token: adminToken, ids_csv: selectedIds.join(',') }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Bulk approve failed')) {
        return
      }
      setAdminMessage(data?.message || 'Bulk approve failed')
      return
    }
    const selectedSet = new Set(selectedIds)
    setPendingItems((items) => items.filter((x) => !selectedSet.has(x.id)))
    setPendingTotal((total) => Math.max(0, total - selectedIds.length))
    setSelectedIds([])
    setAdminMessage(`Approved ${data.updated} photo(s)`)
  }

  const bulkReject = async () => {
    if (!adminToken || !selectedIds.length) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/photos/bulk-reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_token: adminToken, ids_csv: selectedIds.join(',') }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Bulk reject failed')) {
        return
      }
      setAdminMessage(data?.message || 'Bulk reject failed')
      return
    }
    const selectedSet = new Set(selectedIds)
    setPendingItems((items) => items.filter((x) => !selectedSet.has(x.id)))
    setPendingTotal((total) => Math.max(0, total - selectedIds.length))
    setSelectedIds([])
    setAdminMessage(`Rejected ${data.updated} photo(s)`)
  }

  const setUploadsEnabled = async (enabled) => {
    if (!adminToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/upload-toggle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_token: adminToken, enabled: enabled ? '1' : '0' }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Unable to update upload toggle')) {
        return
      }
      setAdminMessage(data?.message || 'Unable to update upload toggle')
      return
    }
    setUploadEnabled(Boolean(data.upload_enabled))
    setAdminMessage(`Uploads ${data.upload_enabled ? 'enabled' : 'disabled'}`)
  }

  const seedDemoApprovedPhoto = async () => {
    const response = await fetch(`${API_BASE_URL}/api/dev/seed-approved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qr_token: 'BALODHI-QR-2026' }),
    })
    const data = await response.json()
    if (!response.ok) {
      setAdminMessage(data?.message || 'Failed to seed demo photo')
      return
    }
    setAdminMessage(`Seeded demo approved photo #${data.photo_id}`)
  }

  const createFamily = async () => {
    if (!adminToken || !newFamilyName.trim()) return
    setCreatingFamily(true)
    setAdminMessage('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/admin/families/create`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ admin_token: adminToken, name: newFamilyName, slug: newFamilySlug, qr_token: newFamilyToken }),
      })
      const data = await response.json()
      if (!response.ok) {
        if (response.status === 401 && handleAdminAuthFailure(data, 'Failed to create family')) {
          return
        }
        setAdminMessage(data?.message || 'Failed to create family')
        return
      }
      setAdminMessage(`✅ Family created: ${data.family.name} — QR token: ${data.family.qr_token} — URL: /f/${data.family.qr_token}`)
      setNewFamilyName('')
      setNewFamilySlug('')
      setNewFamilyToken('')
    } finally {
      setCreatingFamily(false)
    }
  }

  const deletePhoto = useCallback(async (photoId) => {
    if (!adminToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/photos/${photoId}/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ admin_token: adminToken }),
    })
    const data = await response.json()
    if (!response.ok) {
      if (response.status === 401 && handleAdminAuthFailure(data, 'Could not delete photo')) {
        return
      }
      setAdminMessage(data?.message || 'Could not delete photo')
      return
    }
    setApprovedItems((items) => items.filter((item) => item.id !== photoId))
    setApprovedTotal((total) => Math.max(0, total - 1))
    setAdminMessage('Photo removed from gallery')
  }, [adminToken, handleAdminAuthFailure])

  const toggleSelectedId = useCallback((photoId, checked) => {
    if (checked) {
      setSelectedIds((ids) => [...ids, photoId])
      return
    }
    setSelectedIds((ids) => ids.filter((id) => id !== photoId))
  }, [])

  useEffect(() => {
    const saved = getStoredValue('guest_session_token')
    if (saved) {
      setSessionToken(saved)
    }
  }, [])

  useEffect(() => {
    if (adminMode) {
      setLoading(false)
      if (adminToken) {
        Promise.all([loadPending(adminToken, 0), loadUploadToggle(adminToken), loadApproved(adminToken, 0), loadTelemetrySummary(adminToken), loadAdminFamilies(adminToken), loadHealthSnapshot(adminToken)]).catch((e) => {
          setAdminMessage(e?.message || 'Unable to load moderation data')
        })
      }
      return
    }

    if (galleryMode) {
      setLoading(false)
      return
    }

    if (scanMode || introMode) {
      setLoading(false)
      return
    }

    const bootstrapFromPathToken = async () => {
      if (!token) {
        setLoading(false)
        return
      }

      try {
        await bootstrapFromQrToken(token, true)
      } catch {
        setError('Could not read this family QR token. Please scan again.')
        navigate('/scan')
      } finally {
        setLoading(false)
      }
    }

    bootstrapFromPathToken()
  }, [token, adminMode, galleryMode, scanMode, introMode, adminToken, loadPending, loadUploadToggle, loadApproved, loadTelemetrySummary, loadAdminFamilies, loadHealthSnapshot, bootstrapFromQrToken])

  useEffect(() => {
    if (!adminMode || !adminToken) {
      return
    }

    const timer = window.setTimeout(() => {
      setSelectedIds([])
      Promise.all([loadPending(adminToken, 0), loadApproved(adminToken, 0)]).catch((e) => {
        setAdminMessage(e?.message || 'Unable to refresh filtered moderation lists')
      })
    }, 350)

    return () => {
      window.clearTimeout(timer)
    }
  }, [adminMode, adminToken, adminSearch, adminFamilyFilter, adminFromDate, adminToDate, adminLimit, loadPending, loadApproved])

  const adminLogout = () => {
    clearStoredValue('admin_token')
    setAdminToken('')
    setAdminPassword('')
    setAdminMessage('Logged out. Please login again.')
  }

  const loadGallery = useCallback(async (offsetOverride) => {
    if (galleryRequestInFlightRef.current) {
      return
    }

    galleryRequestInFlightRef.current = true
    if (firstGalleryLoadRef.current) {
      setGalleryLoading(true)
    }

    try {
      let activeSessionToken = sessionToken
      if (!activeSessionToken) {
        activeSessionToken = await bootstrapSessionFromSavedToken()
      }

      if (!activeSessionToken) {
        setGalleryMessage('Scan your family QR to start viewing and uploading photos.')
        return
      }

      const nextOffset = Number.isFinite(offsetOverride) ? Math.max(0, Number(offsetOverride)) : galleryOffset
      const params = new URLSearchParams({
        limit: String(galleryLimit),
        offset: String(nextOffset),
      })

      const response = await fetchWithTimeout(`${API_BASE_URL}/api/gallery/approved?${params.toString()}`, {
        headers: { 'x-session-token': activeSessionToken },
      }, 12000)
      const data = await response.json()
      if (!response.ok) {
        setGalleryMessage(data?.message || 'Unable to load gallery')
        galleryPollFailureCountRef.current += 1
        return
      }

      const fetchedItems = Array.isArray(data.items) ? data.items : []
      setGalleryItems(fetchedItems)
      setGalleryOffset(Number(data.offset || 0))
      setGalleryTotal(Number(data.total || 0))
      setGalleryMessage('')
      setGalleryIndex((index) => {
        if (!fetchedItems.length) return 0
        if (nextOffset !== galleryOffset) return 0
        return index % fetchedItems.length
      })
      firstGalleryLoadRef.current = false
      galleryPollFailureCountRef.current = 0
    } catch {
      galleryPollFailureCountRef.current += 1
      setGalleryMessage('Unable to load gallery right now. Please retry in a moment.')
    } finally {
      setGalleryLoading(false)
      galleryRequestInFlightRef.current = false
    }
  }, [sessionToken, bootstrapSessionFromSavedToken, galleryLimit, galleryOffset])

  useEffect(() => {
    if (!galleryMode) {
      firstGalleryLoadRef.current = true
      if (galleryPollTimerRef.current) {
        window.clearTimeout(galleryPollTimerRef.current)
        galleryPollTimerRef.current = null
      }
      return
    }

    let cancelled = false

    const scheduleNext = () => {
      if (cancelled) return
      const failures = galleryPollFailureCountRef.current
      const nextMs = Math.min(60000, 15000 + failures * 7000)
      galleryPollTimerRef.current = window.setTimeout(tick, nextMs)
    }

    const tick = async () => {
      if (cancelled) return
      if (document.visibilityState === 'visible' && !uploading && !drawerPhotoId) {
        await loadGallery()
      }
      scheduleNext()
    }

    tick()

    return () => {
      cancelled = true
      if (galleryPollTimerRef.current) {
        window.clearTimeout(galleryPollTimerRef.current)
        galleryPollTimerRef.current = null
      }
    }
  }, [galleryMode, loadGallery, uploading, drawerPhotoId])

  useEffect(() => {
    if (swipeHintSeen) return
    const t = window.setTimeout(() => {
      setSwipeHintSeen(true)
      setStoredValue('swipe_hint_seen', '1')
    }, 4000)
    return () => window.clearTimeout(t)
  }, [swipeHintSeen])

  const blobToBase64 = async (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = String(reader.result || '')
        const commaIndex = result.indexOf(',')
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : '')
      }
      reader.onerror = () => reject(new Error('Failed to read image'))
      reader.readAsDataURL(blob)
    })
  }

  const compressImage = async (file) => {
    const imageUrl = URL.createObjectURL(file)
    const image = new Image()

    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = imageUrl
    })

    const cropSide = Math.min(image.width, image.height)
    const sx = Math.floor((image.width - cropSide) / 2)
    const sy = Math.floor((image.height - cropSide) / 2)
    const outputSize = Math.min(1200, cropSide)

    const canvas = document.createElement('canvas')
    canvas.width = outputSize
    canvas.height = outputSize
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Image processing failed')
    }

    // Disposable camera style treatment.
    context.filter = 'contrast(1.15) saturate(1.08) sepia(0.18)'
    context.drawImage(image, sx, sy, cropSide, cropSide, 0, 0, outputSize, outputSize)

    const gradient = context.createRadialGradient(
      outputSize / 2,
      outputSize / 2,
      outputSize * 0.25,
      outputSize / 2,
      outputSize / 2,
      outputSize * 0.7
    )
    gradient.addColorStop(0, 'rgba(255,200,120,0.04)')
    gradient.addColorStop(1, 'rgba(20,12,6,0.22)')
    context.fillStyle = gradient
    context.fillRect(0, 0, outputSize, outputSize)

    URL.revokeObjectURL(imageUrl)

    const compressedBlob = await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.72)
    })

    return compressedBlob
  }

  const uploadOne = async (file) => {
    const compressedBlob = await compressImage(file)
    if (!compressedBlob) {
      throw new Error('Failed to compress image')
    }

    const signResponse = await fetch(`${API_BASE_URL}/api/uploads/sign`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_token: sessionToken,
        file_name: file.name,
        file_type: 'image/jpeg',
      }),
    })

    const signData = await signResponse.json()
    if (!signResponse.ok) {
      throw new Error(signData?.message || 'Unable to sign upload')
    }

    const imageBase64 = await blobToBase64(compressedBlob)
    const directResponse = await fetch(`${API_BASE_URL}${signData.upload_url}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_token: sessionToken,
        upload_token: signData.upload_token,
        mime_type: 'image/jpeg',
        image_base64: imageBase64,
      }),
    })

    const directData = await directResponse.json()
    if (!directResponse.ok) {
      throw new Error(directData?.message || 'Unable to upload image')
    }

    const registerResponse = await fetch(`${API_BASE_URL}/api/photos/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        session_token: sessionToken,
        storage_key: directData.storage_key,
        file_url: directData.file_url,
      }),
    })

    const registerData = await registerResponse.json()
    if (!registerResponse.ok) {
      throw new Error(registerData?.message || 'Unable to register photo')
    }
  }

  const onFilesSelected = async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length || !sessionToken) {
      return
    }

    const imageFiles = files.filter((f) => String(f.type || '').startsWith('image/'))
    if (!imageFiles.length) {
      setGalleryMessage('Only image files are supported.')
      return
    }

    const jobs = imageFiles.map((file, index) => {
      const id = `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`
      uploadFilesRef.current.set(id, file)
      return { id, name: file.name, status: 'pending', error: '' }
    })

    setUploading(true)
    setUploadJobs(jobs)

    let doneCount = 0
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i]
      const file = uploadFilesRef.current.get(job.id)
      if (!file) {
        continue
      }

      setUploadJobs((items) => items.map((item) => item.id === job.id ? { ...item, status: 'uploading' } : item))
      try {
        await uploadOne(file)
        doneCount++
        setUploadJobs((items) => items.map((item) => item.id === job.id ? { ...item, status: 'done' } : item))
        uploadFilesRef.current.delete(job.id)
      } catch (uploadError) {
        setUploadJobs((items) => items.map((item) => item.id === job.id ? { ...item, status: 'error', error: uploadError?.message || 'Failed' } : item))
      }
      // Yield to UI thread between files on slower phones.
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }

    setUploading(false)
    setGalleryMessage(doneCount ? `${doneCount} photo(s) uploaded. Pending moderation.` : 'Upload failed. Please retry.')
    if (doneCount > 0) {
      loadGallery()
    }
    event.target.value = ''
  }

  const retryFailedUploads = async () => {
    if (!sessionToken || uploading) {
      return
    }
    const failed = uploadJobs.filter((job) => job.status === 'error' && uploadFilesRef.current.has(job.id))

    if (!failed.length) {
      return
    }

    setUploading(true)
    let retried = 0

    for (const job of failed) {
      const file = uploadFilesRef.current.get(job.id)
      if (!file) {
        continue
      }

      setUploadJobs((jobs) => jobs.map((j) => j.id === job.id ? { ...j, status: 'uploading', error: '' } : j))
      try {
        await uploadOne(file)
        retried += 1
        setUploadJobs((jobs) => jobs.map((j) => j.id === job.id ? { ...j, status: 'done' } : j))
        uploadFilesRef.current.delete(job.id)
      } catch (retryError) {
        setUploadJobs((jobs) => jobs.map((j) => j.id === job.id ? { ...j, status: 'error', error: retryError?.message || 'Failed' } : j))
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }

    setUploading(false)
    setGalleryMessage(retried ? `Retried ${retried} photo(s) successfully.` : 'Retry failed. Please try again.')
    if (retried > 0) {
      loadGallery()
    }
  }

  const brokenPhotoIdSet = useMemo(() => new Set(brokenPhotoIds), [brokenPhotoIds])

  const visibleGalleryItems = useMemo(
    () => galleryItems.filter((item) => !brokenPhotoIdSet.has(item.id)),
    [galleryItems, brokenPhotoIdSet]
  )
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const selectedFamilyId = useMemo(() => {
    const parsed = Number(adminFamilyFilter || 0)
    return Number.isFinite(parsed) ? parsed : 0
  }, [adminFamilyFilter])
  const selectedFamilyName = useMemo(() => {
    if (selectedFamilyId <= 0) {
      return ''
    }
    const family = adminFamilies.find((item) => Number(item.id) === selectedFamilyId)
    return family?.name || ''
  }, [adminFamilies, selectedFamilyId])
  const activeAdminFilters = useMemo(() => {
    const chips = []
    const trimmedSearch = adminSearch.trim()
    if (trimmedSearch) {
      chips.push({ key: 'search', label: `Search: ${trimmedSearch}` })
    }
    if (selectedFamilyId > 0) {
      chips.push({ key: 'family', label: `Family: ${selectedFamilyName || selectedFamilyId}` })
    }
    if (adminFromDate || adminToDate) {
      const fromLabel = adminFromDate || 'any'
      const toLabel = adminToDate || 'any'
      chips.push({ key: 'date', label: `Date: ${fromLabel} to ${toLabel}` })
    }
    return chips
  }, [adminSearch, selectedFamilyId, selectedFamilyName, adminFromDate, adminToDate])
  const failedJobsCount = useMemo(
    () => uploadJobs.reduce((count, job) => count + (job.status === 'error' ? 1 : 0),
      0),
    [uploadJobs]
  )
  const currentCard = visibleGalleryItems.length
    ? visibleGalleryItems[galleryIndex % visibleGalleryItems.length]
    : null

  const reactAndNext = async (reactionType) => {
    if (!currentCard || !sessionToken) {
      return
    }
    try {
      await fetch(`${API_BASE_URL}/api/photos/${currentCard.id}/reaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken, type: reactionType }),
      })
    } catch {
      // Keep swipe flow smooth even if reaction fails.
    }
    setGalleryIndex((index) => index + 1)
  }

  const triggerFly = (dir) => {
    setFlyDir(dir)
    setDragX(null)
    dragOriginRef.current = null
    const reactionType = dir === 'superlike' ? 'superlike' : dir === 'like' ? 'like' : 'skip'
    setTimeout(() => {
      setFlyDir(null)
      reactAndNext(reactionType)
    }, 320)
  }

  const onCardPointerDown = (e) => {
    if (flyDir !== null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragOriginRef.current = e.clientX
    wasDragRef.current = false
    setDragX(0)
  }

  const onCardPointerMove = (e) => {
    if (dragOriginRef.current === null) return
    const dx = e.clientX - dragOriginRef.current
    if (Math.abs(dx - (dragX || 0)) < 3) return
    if (Math.abs(dx) > 6) wasDragRef.current = true

    pendingDragXRef.current = dx
    if (dragRafRef.current !== null) return
    dragRafRef.current = window.requestAnimationFrame(() => {
      setDragX(pendingDragXRef.current)
      dragRafRef.current = null
    })
  }

  const onCardPointerUp = () => {
    if (dragOriginRef.current === null) return
    const delta = dragX ?? 0
    dragOriginRef.current = null
    if (delta > 90) {
      triggerFly('like')
    } else if (delta < -90) {
      triggerFly('skip')
    } else {
      setDragX(null)
    }
  }

  const onCardPointerCancel = () => {
    dragOriginRef.current = null
    setDragX(null)
  }

  useEffect(() => {
    const uploadFiles = uploadFilesRef.current

    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current)
      }
      uploadFiles.clear()
    }
  }, [])

  useEffect(() => {
    if (!brokenPhotoIds.length) {
      return
    }

    const idsInGallery = new Set(galleryItems.map((item) => item.id))
    setBrokenPhotoIds((ids) => ids.filter((id) => idsInGallery.has(id)))
  }, [galleryItems, brokenPhotoIds.length])

  useEffect(() => {
    if (!uploadJobs.length || uploading) {
      return
    }

    const hasErrors = uploadJobs.some((job) => job.status === 'error')
    if (hasErrors) {
      return
    }

    const clearTimer = window.setTimeout(() => {
      setUploadJobs([])
    }, 2500)

    return () => window.clearTimeout(clearTimer)
  }, [uploadJobs, uploading])

  const cardDragStyle = (() => {
    if (flyDir === 'like') return { transform: 'translateX(600px) rotate(22deg)', transition: 'transform 0.32s ease-in', pointerEvents: 'none' }
    if (flyDir === 'skip') return { transform: 'translateX(-600px) rotate(-22deg)', transition: 'transform 0.32s ease-in', pointerEvents: 'none' }
    if (flyDir === 'superlike') return { transform: 'translateY(-600px) scale(1.08)', transition: 'transform 0.32s ease-in', pointerEvents: 'none' }
    if (dragX !== null) {
      const rot = Math.max(-18, Math.min(18, dragX * 0.08))
      return { transform: `translateX(${dragX}px) rotate(${rot}deg)`, transition: 'none', cursor: 'grabbing' }
    }
    return { transition: 'transform 0.18s ease-out', cursor: 'grab' }
  })()

  const likeOpacity = dragX !== null && dragX > 15 ? Math.min((dragX - 15) / 80, 1) : 0
  const skipOpacity = dragX !== null && dragX < -15 ? Math.min((-dragX - 15) / 80, 1) : 0

  const loadComments = useCallback(async (photoId, offsetOverride) => {
    const tok = sessionToken
    if (!tok) return

    const currentOffset = Number(commentOffsets[photoId] || 0)
    const nextOffset = Number.isFinite(offsetOverride) ? Math.max(0, Number(offsetOverride)) : currentOffset
    if (commentLoading[photoId]) {
      return
    }

    if (commentsCacheRef.current[photoId] && nextOffset === currentOffset) return

    setCommentLoading((prev) => ({ ...prev, [photoId]: true }))
    try {
      const params = new URLSearchParams({ limit: String(COMMENT_PAGE_SIZE), offset: String(nextOffset) })
      const res = await fetchWithTimeout(`${API_BASE_URL}/api/photos/${photoId}/comments?${params.toString()}`, {
        headers: { 'x-session-token': tok },
      }, 10000)
      const data = await res.json()
      if (res.ok) {
        setComments((prev) => ({ ...prev, [photoId]: data.comments || [] }))
        setCommentOffsets((prev) => ({ ...prev, [photoId]: Number(data.offset || 0) }))
        setCommentTotals((prev) => ({ ...prev, [photoId]: Number(data.total || 0) }))
      }
    } catch { /* silent */ }
    finally {
      setCommentLoading((prev) => ({ ...prev, [photoId]: false }))
    }
  }, [sessionToken, commentOffsets, commentLoading])

  const openDrawer = (photoId) => {
    setDrawerPhotoId(photoId)
    setCommentText('')
    loadComments(photoId, 0)
  }

  const closeDrawer = () => {
    if (drawerPhotoId) {
      setComments((prev) => {
        const next = { ...prev }
        delete next[drawerPhotoId]
        return next
      })
      setCommentOffsets((prev) => {
        const next = { ...prev }
        delete next[drawerPhotoId]
        return next
      })
      setCommentTotals((prev) => {
        const next = { ...prev }
        delete next[drawerPhotoId]
        return next
      })
      setCommentLoading((prev) => {
        const next = { ...prev }
        delete next[drawerPhotoId]
        return next
      })
    }
    setDrawerPhotoId(null)
  }

  const submitQrToken = useCallback(async (providedToken) => {
    if (scannerBusyRef.current) {
      return
    }
    const value = String(providedToken || '').trim()
    if (!value) {
      setScanMessage('Enter a valid family token')
      return
    }

    setScannerBusy(true)
    setScanMessage('Verifying token...')
    try {
      await bootstrapFromQrToken(value, true)
    } catch (scanError) {
      logClientTelemetry('scanner_token_verify_failed', {
        message: String(scanError?.message || 'unknown'),
      })
      setScanMessage(scanError?.message || 'Token invalid. Please retry.')
      setScannerBusy(false)
    }
  }, [bootstrapFromQrToken, logClientTelemetry])

  useEffect(() => {
    if (!scanMode) {
      if (scannerLoopRef.current) {
        window.clearTimeout(scannerLoopRef.current)
        scannerLoopRef.current = null
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop())
        cameraStreamRef.current = null
      }
      return
    }

    let mounted = true

    const setupScanner = async () => {
      setScanMessage('Allow camera access to scan your family QR')

      if (!window.isSecureContext) {
        logClientTelemetry('scanner_secure_context_required', { secure: false })
        setScanMessage('Camera needs a secure connection (https) here. Enter token manually below.')
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        logClientTelemetry('scanner_media_devices_unavailable')
        setScanMessage('Camera is unavailable on this device. Enter token manually below.')
        return
      }

      if (!('BarcodeDetector' in window)) {
        logClientTelemetry('scanner_barcode_detector_unsupported')
        setScanMessage('Camera scanning is not supported on this browser. Enter token manually below.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })

        if (!mounted) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        cameraStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }

        const detector = new window.BarcodeDetector({ formats: ['qr_code'] })

        const runScan = async () => {
          if (!mounted || !scanMode) {
            return
          }

          if (document.visibilityState !== 'visible' || !videoRef.current || scannerBusyRef.current || scannerInFlightRef.current) {
            scannerLoopRef.current = window.setTimeout(runScan, 900)
            return
          }

          scannerInFlightRef.current = true
          try {
            const codes = await detector.detect(videoRef.current)
            if (codes && codes.length > 0) {
              const raw = String(codes[0].rawValue || '').trim()
              if (raw) {
                const tokenMatch = raw.match(/\/f\/([^/?#]+)/)
                const pickedToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : raw
                submitQrToken(pickedToken)
              }
            }
          } catch {
            // Ignore intermittent scanner frame failures.
          } finally {
            scannerInFlightRef.current = false
          }

          scannerLoopRef.current = window.setTimeout(runScan, 650)
        }

        runScan()
      } catch (scannerError) {
        const errorName = String(scannerError?.name || '')
        if (errorName === 'NotAllowedError' || errorName === 'SecurityError') {
          logClientTelemetry('scanner_permission_denied', { error_name: errorName })
          setScanMessage('Camera permission denied. Enter token manually below.')
          return
        }
        if (errorName === 'NotFoundError' || errorName === 'OverconstrainedError') {
          logClientTelemetry('scanner_camera_not_found', { error_name: errorName })
          setScanMessage('No compatible camera was found. Enter token manually below.')
          return
        }
        if (errorName === 'NotReadableError') {
          logClientTelemetry('scanner_camera_in_use', { error_name: errorName })
          setScanMessage('Camera is already in use by another app. Enter token manually below.')
          return
        }
        logClientTelemetry('scanner_setup_failed', {
          error_name: errorName || 'unknown',
          message: String(scannerError?.message || 'unknown'),
        })
        console.warn('Scanner setup failed', scannerError)
        setScanMessage('Camera could not start right now. Enter token manually below.')
      }
    }

    setupScanner()

    return () => {
      mounted = false
      if (scannerLoopRef.current) {
        window.clearTimeout(scannerLoopRef.current)
        scannerLoopRef.current = null
      }
      scannerInFlightRef.current = false
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop())
        cameraStreamRef.current = null
      }
    }
  }, [scanMode, submitQrToken, logClientTelemetry])

  useEffect(() => {
    if (!galleryMode) {
      return
    }
    loadGallery(0)
  }, [galleryMode, galleryLimit, loadGallery])

  const submitComment = async (photoId) => {
    const text = commentText.trim()
    if (!text || !sessionToken) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/photos/${photoId}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_token: sessionToken, body: text }),
      })
      const data = await res.json()
      if (res.ok) {
        setComments((prev) => ({
          ...prev,
          [photoId]: [...(prev[photoId] || []), { id: data.id, display_name: data.display_name, body: data.body, created_at: new Date().toISOString() }],
        }))
        setCommentTotals((prev) => ({ ...prev, [photoId]: Number(prev[photoId] || 0) + 1 }))
        setCommentText('')
      }
    } catch { /* silent */ }
  }

  const onCardImageError = () => {
    if (!currentCard) {
      return
    }
    setBrokenPhotoIds((ids) => (ids.includes(currentCard.id) ? ids : [...ids, currentCard.id]))
    setGalleryMessage('Some older photos are unavailable in local storage. Upload fresh photos to view in gallery.')
  }

  const onImageClick = (url) => {
    if (wasDragRef.current) return
    setLightboxUrl(url)
  }

  const closeLightbox = useCallback(() => {
    setLightboxUrl(null)
  }, [])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') closeLightbox() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeLightbox])

  if (loading) {
    return (
      <main className="shell">
        {topRibbon}
        <section className="card">
          <div className="spinner" />
          <p className="hint">Getting your access ready…</p>
        </section>
      </main>
    )
  }

  if (adminMode) {
    return (
      <main className="shell admin-shell">
        {topRibbon}
        <section className="card admin-card">
          <h1>Moderation Dashboard</h1>

          {!adminToken ? (
            <div className="admin-login">
              <input
                value={adminPassword}
                type="password"
                placeholder="Admin password"
                onChange={(event) => setAdminPassword(event.target.value)}
                className="name-input"
              />
              <button className="primary" onClick={adminLogin}>Login</button>
            </div>
          ) : (
            <div className="admin-layout">
              <aside className="admin-sidebar">
                <button className={`admin-menu-item ${adminSection === 'create' ? 'active' : ''}`} onClick={() => setAdminSection('create')}>Create Family</button>
                <button className={`admin-menu-item ${adminSection === 'approve' ? 'active' : ''}`} onClick={() => setAdminSection('approve')}>Approve Photos</button>
                <button className={`admin-menu-item ${adminSection === 'delete' ? 'active' : ''}`} onClick={() => setAdminSection('delete')}>Delete from Gallery</button>
                <button className={`admin-menu-item ${adminSection === 'toggle' ? 'active' : ''}`} onClick={() => setAdminSection('toggle')}>Upload Toggle</button>
                <button className={`admin-menu-item ${adminSection === 'tools' ? 'active' : ''}`} onClick={() => setAdminSection('tools')}>Utilities</button>
                <button className="admin-menu-item" onClick={adminLogout}>Logout</button>
              </aside>

              <div className="admin-content">
                {adminSection === 'create' ? (
                  <div className="family-create">
                    <h2 className="section-heading">Create a Family</h2>
                    <div className="family-create-grid">
                      <input className="name-input" placeholder="Family name *" value={newFamilyName} onChange={(e) => setNewFamilyName(e.target.value)} />
                      <input className="name-input" placeholder="Slug (optional, auto-generated)" value={newFamilySlug} onChange={(e) => setNewFamilySlug(e.target.value)} />
                      <input className="name-input" placeholder="QR token (optional, auto-generated)" value={newFamilyToken} onChange={(e) => setNewFamilyToken(e.target.value)} />
                      <button className="primary small" disabled={!newFamilyName.trim() || creatingFamily} onClick={createFamily}>
                        {creatingFamily ? 'Creating…' : 'Create Family'}
                      </button>
                    </div>
                  </div>
                ) : null}

                {adminSection === 'approve' ? (
                  <>
                    <div className="admin-toolbar">
                      <button className="primary small" onClick={() => loadPending(undefined, pendingOffset)}>Refresh Pending</button>
                      <button className="primary small" disabled={!selectedIds.length} onClick={bulkApprove}>
                        Bulk Approve ({selectedIds.length})
                      </button>
                      <button className="danger small" disabled={!selectedIds.length} onClick={bulkReject}>
                        Bulk Reject ({selectedIds.length})
                      </button>
                    </div>
                    <div className="admin-filter-grid">
                      <input
                        className="name-input"
                        placeholder="Search guest or family"
                        value={adminSearch}
                        onChange={(e) => setAdminSearch(e.target.value)}
                      />
                      <select className="name-input" value={adminFamilyFilter} onChange={(e) => setAdminFamilyFilter(e.target.value)}>
                        <option value="0">All families</option>
                        {adminFamilies.map((family) => (
                          <option key={family.id} value={String(family.id)}>{family.name}</option>
                        ))}
                      </select>
                      <input
                        className="name-input"
                        type="date"
                        value={adminFromDate}
                        onChange={(e) => setAdminFromDate(e.target.value)}
                      />
                      <input
                        className="name-input"
                        type="date"
                        value={adminToDate}
                        onChange={(e) => setAdminToDate(e.target.value)}
                      />
                      <div className="admin-date-presets">
                        <button className="secondary small" onClick={() => applyAdminDatePreset('today')}>Today</button>
                        <button className="secondary small" onClick={() => applyAdminDatePreset('last7')}>Last 7 days</button>
                        <button className="secondary small" onClick={() => applyAdminDatePreset('clear')}>Clear dates</button>
                      </div>
                      <select className="name-input" value={adminLimit} onChange={(e) => setAdminLimit(Number(e.target.value) || 50)}>
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                      </select>
                    </div>
                    {activeAdminFilters.length > 0 ? (
                      <div className="admin-filter-chips-row">
                        {activeAdminFilters.map((chip) => (
                          <span key={chip.key} className="admin-filter-chip">{chip.label}</span>
                        ))}
                        <button className="secondary small" onClick={clearAdminFilters}>Clear filters</button>
                      </div>
                    ) : null}
                    <p className="hint admin-list-summary">
                      Showing {pendingItems.length} pending photo(s), total {pendingTotal}
                    </p>
                    <div className="moderation-grid">
                      {pendingItems.length === 0 ? <p className="hint">No pending photos.</p> : null}
                      {pendingItems.map((item) => (
                        <PendingPhotoItem
                          key={item.id}
                          item={item}
                          isSelected={selectedIdSet.has(item.id)}
                          onToggleSelect={toggleSelectedId}
                          onModerate={moderateOne}
                          onPreview={setLightboxUrl}
                        />
                      ))}
                    </div>
                    <div className="admin-pagination">
                      <button
                        className="secondary small"
                        disabled={pendingOffset <= 0}
                        onClick={() => {
                          setSelectedIds([])
                          loadPending(undefined, Math.max(0, pendingOffset - adminLimit))
                        }}
                      >
                        Previous
                      </button>
                      <button
                        className="secondary small"
                        disabled={pendingOffset + pendingItems.length >= pendingTotal}
                        onClick={() => {
                          setSelectedIds([])
                          loadPending(undefined, pendingOffset + adminLimit)
                        }}
                      >
                        Next
                      </button>
                    </div>
                  </>
                ) : null}

                {adminSection === 'delete' ? (
                  <>
                    <div className="admin-toolbar">
                      <button className="primary small" onClick={() => loadApproved(undefined, approvedOffset)}>Refresh Approved</button>
                    </div>
                    <div className="admin-filter-grid">
                      <input
                        className="name-input"
                        placeholder="Search guest or family"
                        value={adminSearch}
                        onChange={(e) => setAdminSearch(e.target.value)}
                      />
                      <select className="name-input" value={adminFamilyFilter} onChange={(e) => setAdminFamilyFilter(e.target.value)}>
                        <option value="0">All families</option>
                        {adminFamilies.map((family) => (
                          <option key={family.id} value={String(family.id)}>{family.name}</option>
                        ))}
                      </select>
                      <input
                        className="name-input"
                        type="date"
                        value={adminFromDate}
                        onChange={(e) => setAdminFromDate(e.target.value)}
                      />
                      <input
                        className="name-input"
                        type="date"
                        value={adminToDate}
                        onChange={(e) => setAdminToDate(e.target.value)}
                      />
                      <div className="admin-date-presets">
                        <button className="secondary small" onClick={() => applyAdminDatePreset('today')}>Today</button>
                        <button className="secondary small" onClick={() => applyAdminDatePreset('last7')}>Last 7 days</button>
                        <button className="secondary small" onClick={() => applyAdminDatePreset('clear')}>Clear dates</button>
                      </div>
                      <select className="name-input" value={adminLimit} onChange={(e) => setAdminLimit(Number(e.target.value) || 50)}>
                        <option value={25}>25 / page</option>
                        <option value={50}>50 / page</option>
                        <option value={100}>100 / page</option>
                      </select>
                    </div>
                    {activeAdminFilters.length > 0 ? (
                      <div className="admin-filter-chips-row">
                        {activeAdminFilters.map((chip) => (
                          <span key={chip.key} className="admin-filter-chip">{chip.label}</span>
                        ))}
                        <button className="secondary small" onClick={clearAdminFilters}>Clear filters</button>
                      </div>
                    ) : null}
                    <p className="hint admin-list-summary">
                      Showing {approvedItems.length} approved photo(s), total {approvedTotal}
                    </p>
                    <div className="moderation-grid">
                      {approvedItems.length === 0 ? <p className="hint">No approved photos.</p> : null}
                      {approvedItems.map((item) => (
                        <ApprovedPhotoItem key={item.id} item={item} onDelete={deletePhoto} onPreview={setLightboxUrl} />
                      ))}
                    </div>
                    <div className="admin-pagination">
                      <button
                        className="secondary small"
                        disabled={approvedOffset <= 0}
                        onClick={() => loadApproved(undefined, Math.max(0, approvedOffset - adminLimit))}
                      >
                        Previous
                      </button>
                      <button
                        className="secondary small"
                        disabled={approvedOffset + approvedItems.length >= approvedTotal}
                        onClick={() => loadApproved(undefined, approvedOffset + adminLimit)}
                      >
                        Next
                      </button>
                    </div>
                  </>
                ) : null}

                {adminSection === 'toggle' ? (
                  <div className="family-create">
                    <h2 className="section-heading">Upload Toggle</h2>
                    <p className="hint">Use this if you need to temporarily pause new uploads.</p>
                    <button className="primary small" onClick={() => setUploadsEnabled(!uploadEnabled)}>
                      Uploads: {uploadEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ) : null}

                {adminSection === 'tools' ? (
                  <div className="family-create">
                    <h2 className="section-heading">Utilities</h2>
                    <div className="admin-toolbar">
                      <button className="primary small" onClick={() => {
                        loadPending()
                        loadApproved()
                        loadUploadToggle()
                        loadTelemetrySummary()
                        loadHealthSnapshot()
                      }}>
                        Refresh All Data
                      </button>
                      <button className="primary small" onClick={() => loadTelemetrySummary()}>
                        Refresh Telemetry
                      </button>
                      <button className="primary small" onClick={() => loadHealthSnapshot()}>
                        Refresh Health
                      </button>
                      <button className="danger small" onClick={resetTelemetry}>
                        Reset Telemetry
                      </button>
                      <button className="primary small" disabled={runningOpsChecks} onClick={() => runOpsChecks()}>
                        {runningOpsChecks ? 'Running Ops Sweep…' : 'Run Full Ops Sweep'}
                      </button>
                      <button className="secondary small" disabled={runningOpsChecks || failedOpsChecks.length === 0} onClick={retryFailedOpsChecks}>
                        Retry Failed ({failedOpsChecks.length})
                      </button>
                      <button className="secondary small" onClick={copyDiagnostics}>
                        Copy Diagnostics JSON
                      </button>
                      <button className="secondary small" onClick={exportDiagnostics}>
                        Export Diagnostics
                      </button>
                      {import.meta.env.DEV ? <button className="primary small" onClick={seedDemoApprovedPhoto}>Seed Demo Photo</button> : null}
                    </div>
                    <label className="ops-capture-toggle">
                      <input
                        type="checkbox"
                        checked={diagCaptureRaw}
                        onChange={(e) => setDiagCaptureRaw(e.target.checked)}
                      />
                      Capture raw endpoint responses in diagnostics
                    </label>
                    <div className="ops-check-panel">
                      {opsChecksSummary ? (
                        <div className={`ops-check-summary ${opsChecksSummary.failed > 0 ? 'fail' : 'ok'}`}>
                          <span>{opsChecksSummary.scope === 'retry' ? 'Retry Sweep' : 'Full Sweep'}: {opsChecksSummary.passed}/{opsChecksSummary.total} passed</span>
                          <span>Failed: {opsChecksSummary.failed}</span>
                          <span>Duration: {opsChecksSummary.duration_ms} ms</span>
                        </div>
                      ) : null}
                      {opsChecks.length === 0 ? <p className="hint tiny">No checks run yet.</p> : null}
                      {opsChecks.map((check) => (
                        <div className="ops-check-row" key={check.name}>
                          <span className={`ops-check-status ${check.ok ? 'ok' : 'fail'}`}>{check.ok ? 'PASS' : 'FAIL'}</span>
                          <span className="ops-check-name">{check.name}</span>
                          <span className="ops-check-detail">{check.detail}</span>
                          {!check.ok ? (
                            <button className="secondary tiny" disabled={runningOpsChecks} onClick={() => runOpsChecks({ onlyChecks: [check.name] })}>
                              Retry
                            </button>
                          ) : (
                            <span className="ops-check-action-spacer" aria-hidden="true" />
                          )}
                        </div>
                      ))}
                    </div>
                    {healthSnapshot ? (
                      <div className="health-panel">
                        <p className="hint tiny health-time">Updated: {healthSnapshot.now}</p>
                        <div className="health-badges">
                          <span className={`health-badge ${healthSnapshot.status?.db_ok ? 'ok' : 'warn'}`}>DB: {healthSnapshot.status?.db_ok ? 'OK' : 'Issue'}</span>
                          <span className={`health-badge ${healthSnapshot.status?.s3_configured ? 'ok' : 'warn'}`}>S3: {healthSnapshot.status?.s3_configured ? 'Configured' : 'Missing'}</span>
                          <span className={`health-badge ${healthSnapshot.status?.upload_enabled ? 'ok' : 'warn'}`}>Uploads: {healthSnapshot.status?.upload_enabled ? 'Enabled' : 'Disabled'}</span>
                        </div>
                        <div className="health-grid">
                          <span className="health-item">Families: {healthSnapshot.counts?.families ?? 0}</span>
                          <span className="health-item">Pending photos: {healthSnapshot.counts?.pending_photos ?? 0}</span>
                          <span className="health-item">Approved photos: {healthSnapshot.counts?.approved_photos ?? 0}</span>
                          <span className="health-item">Active sessions: {healthSnapshot.counts?.active_sessions ?? 0}</span>
                          <span className="health-item">Telemetry events: {healthSnapshot.counts?.telemetry_events ?? 0}</span>
                          <span className="health-item">DB size: {healthSnapshot.storage?.db_file_size_mb ?? 0} MB</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="telemetry-panel">
                      <div className="telemetry-summary-grid">
                        <span className="telemetry-summary-item">Route hits: {telemetryTotals.route_hits}</span>
                        <span className="telemetry-summary-item">Latency events: {telemetryTotals.latency_events}</span>
                        <span className="telemetry-summary-item">Client events: {telemetryTotals.client_events}</span>
                        <span className="telemetry-summary-item">Other events: {telemetryTotals.other_events}</span>
                      </div>

                      {telemetryGroups.route_hits.length > 0 ? (
                        <div className="telemetry-section">
                          <h3 className="telemetry-heading">Route Hits</h3>
                          {telemetryGroups.route_hits.map((entry) => (
                            <div className="telemetry-row" key={entry.event}>
                              <span className="telemetry-event">{entry.event}</span>
                              <span className="telemetry-count">{entry.count}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {telemetryGroups.latency_buckets.length > 0 ? (
                        <div className="telemetry-section">
                          <h3 className="telemetry-heading">Latency Buckets</h3>
                          {telemetryGroups.latency_buckets.map((entry) => (
                            <div className="telemetry-row" key={entry.event}>
                              <span className="telemetry-event">{entry.event}</span>
                              <span className="telemetry-count">{entry.count}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {telemetryGroups.client_events.length > 0 ? (
                        <div className="telemetry-section">
                          <h3 className="telemetry-heading">Client Events</h3>
                          {telemetryGroups.client_events.map((entry) => (
                            <div className="telemetry-row" key={entry.event}>
                              <span className="telemetry-event">{entry.event}</span>
                              <span className="telemetry-count">{entry.count}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {telemetryGroups.other.length > 0 ? (
                        <div className="telemetry-section">
                          <h3 className="telemetry-heading">Other</h3>
                          {telemetryGroups.other.map((entry) => (
                            <div className="telemetry-row" key={entry.event}>
                              <span className="telemetry-event">{entry.event}</span>
                              <span className="telemetry-count">{entry.count}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {telemetryCounters.length === 0 ? <p className="hint tiny">No telemetry events yet.</p> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {adminMessage ? <p className="upload-note">{adminMessage}</p> : null}
        </section>
      </main>
    )
  }

  if (scanMode) {
    return (
      <main className="shell">
        {topRibbon}
        <section className="card scan-card">
          <p className="eyebrow">Shivani &amp; Nishant · 12 Dec 2026</p>
          <h1>Scan Family QR</h1>
          <p className="hint">Scan your family QR from camera, or enter token manually below.</p>

          <div className="scan-preview-wrap">
            <video className="scan-preview" ref={videoRef} muted playsInline />
          </div>

          {scanMessage ? <p className="upload-note">{scanMessage}</p> : null}

          <div className="scan-manual-row">
            <input
              value={manualToken}
              onChange={(event) => setManualToken(event.target.value)}
              placeholder="Enter family token"
              className="name-input"
            />
            <button className="primary" disabled={scannerBusy} onClick={() => submitQrToken(manualToken)}>
              {scannerBusy ? 'Joining…' : 'Join Gallery'}
            </button>
          </div>
        </section>
      </main>
    )
  }

  if (galleryMode) {
    const cardComments = drawerPhotoId ? (comments[drawerPhotoId] || []) : []
    const currentCommentOffset = drawerPhotoId ? Number(commentOffsets[drawerPhotoId] || 0) : 0
    const currentCommentTotal = drawerPhotoId ? Number(commentTotals[drawerPhotoId] || 0) : 0
    const currentCommentLoading = drawerPhotoId ? Boolean(commentLoading[drawerPhotoId]) : false

    return (
      <main className="shell gallery-shell">
        {topRibbon}
        <GalleryLightbox url={lightboxUrl} onClose={closeLightbox} />

        <section className="card gallery-card">
          <p className="eyebrow">Shivani &amp; Nishant · 12 Dec 2026</p>
          <h1>The Wedding Album 📸</h1>
          {!sessionToken ? (
            <p className="error">Scan your family QR to continue.</p>
          ) : null}
          {galleryMessage ? <p className="upload-note">{galleryMessage}</p> : null}

          <UploadProgressList jobs={uploadJobs} />

          {failedJobsCount > 0 ? (
            <button className="secondary retry-btn" disabled={uploading} onClick={retryFailedUploads}>
              {uploading ? 'Retrying…' : `Retry Failed Uploads (${failedJobsCount})`}
            </button>
          ) : null}

          {galleryLoading && !currentCard ? (
            <div className="gallery-skeleton">
              <div className="gallery-skeleton-img" />
              <div className="gallery-skeleton-line" />
              <div className="gallery-skeleton-line short" />
            </div>
          ) : null}

          {visibleGalleryItems.length > 0 ? (
            <p className="photo-counter">{(galleryIndex % visibleGalleryItems.length) + 1} / {visibleGalleryItems.length}</p>
          ) : null}

          <div className="gallery-pagination-row">
            <select
              className="name-input gallery-page-size"
              value={galleryLimit}
              onChange={(e) => {
                const nextLimit = Number(e.target.value) || 80
                setGalleryLimit(nextLimit)
              }}
            >
              <option value={40}>40 / page</option>
              <option value={80}>80 / page</option>
              <option value={120}>120 / page</option>
            </select>
            <p className="hint gallery-page-summary">Showing {visibleGalleryItems.length} of {galleryTotal}</p>
            <div className="gallery-pagination-actions">
              <button
                className="secondary small"
                disabled={galleryOffset <= 0 || galleryLoading}
                onClick={() => loadGallery(Math.max(0, galleryOffset - galleryLimit))}
              >
                Newer
              </button>
              <button
                className="secondary small"
                disabled={galleryOffset + galleryItems.length >= galleryTotal || galleryLoading}
                onClick={() => loadGallery(galleryOffset + galleryLimit)}
              >
                Older
              </button>
            </div>
          </div>

          {currentCard ? (
            <article
              className="swipe-card"
              style={cardDragStyle}
              onPointerDown={onCardPointerDown}
              onPointerMove={onCardPointerMove}
              onPointerUp={onCardPointerUp}
              onPointerCancel={onCardPointerCancel}
            >
              {!swipeHintSeen ? (
                <div className="swipe-hint-overlay">
                  <p>👈 Swipe left to skip</p>
                  <p>Swipe right to like 👉</p>
                  <p>Tap photo to expand</p>
                </div>
              ) : null}
              <div className="swipe-overlay-stamp like-stamp" style={{ opacity: likeOpacity }}>LIKE</div>
              <div className="swipe-overlay-stamp skip-stamp" style={{ opacity: skipOpacity }}>NOPE</div>
              <div className="swipe-image-wrap">
                <div className="swipe-overlay" style={{ opacity: Math.max(likeOpacity, skipOpacity), background: likeOpacity >= skipOpacity ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)' }} />
                {currentCard.filtered_url ? (
                  <img
                    className="swipe-image"
                    src={currentCard.filtered_url}
                    alt="Approved wedding memory"
                    onError={onCardImageError}
                    onClick={() => onImageClick(currentCard.filtered_url)}
                    draggable={false}
                  />
                ) : (
                  <div className="swipe-placeholder">No image preview</div>
                )}
              </div>
              <div className="card-meta-row">
                <p className="hint">{currentCard.family_name}{currentCard.guest_name ? ` • ${currentCard.guest_name}` : ''}</p>
                <button
                  className="comment-toggle"
                  onClick={() => drawerPhotoId === currentCard.id ? closeDrawer() : openDrawer(currentCard.id)}
                >
                  Comments ({(comments[currentCard.id] || []).length})
                </button>
              </div>
              <div className="swipe-actions">
                <button className="danger small" onClick={() => triggerFly('skip')}>Skip</button>
                <button className="primary small" onClick={() => triggerFly('like')}>Like</button>
                <button className="primary small" onClick={() => triggerFly('superlike')}>Super</button>
              </div>


              {drawerPhotoId === currentCard.id ? (
                <div className="comment-drawer">
                  <div className="comment-toolbar">
                    <p className="hint tiny comment-summary">Showing {cardComments.length} of {currentCommentTotal}</p>
                    <div className="comment-pagination-actions">
                      <button
                        className="secondary small"
                        disabled={currentCommentOffset <= 0 || currentCommentLoading}
                        onClick={() => loadComments(currentCard.id, Math.max(0, currentCommentOffset - COMMENT_PAGE_SIZE))}
                      >
                        Earlier
                      </button>
                      <button
                        className="secondary small"
                        disabled={currentCommentOffset + cardComments.length >= currentCommentTotal || currentCommentLoading}
                        onClick={() => loadComments(currentCard.id, currentCommentOffset + COMMENT_PAGE_SIZE)}
                      >
                        Later
                      </button>
                    </div>
                  </div>
                  <div className="comment-list">
                    {cardComments.length === 0 ? <p className="hint tiny">No comments yet. Be first!</p> : null}
                    {cardComments.map((c) => (
                      <div key={c.id} className="comment-item">
                        <span className="comment-author">{c.display_name || 'Guest'}</span>
                        <span className="comment-body">{c.body}</span>
                      </div>
                    ))}
                  </div>
                  <div className="comment-input-row">
                    <input
                      className="comment-input"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment…"
                      maxLength={500}
                      onKeyDown={(e) => { if (e.key === 'Enter') submitComment(currentCard.id) }}
                    />
                    <button className="primary small" onClick={() => submitComment(currentCard.id)}>Send</button>
                  </div>
                </div>
              ) : null}
            </article>
          ) : (
            <p className="hint">No photos yet — check back soon after some memories are shared! 🎊</p>
          )}
        </section>

        <label
          className={`upload-fab gallery-upload-fab ${!sessionToken || uploading ? 'disabled' : ''}`}
          aria-label={uploading ? 'Uploading photos' : 'Upload photos'}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={!sessionToken || uploading}
            onChange={onFilesSelected}
          />
          <span className="upload-fab-main">
            <span className="upload-fab-icon" aria-hidden="true">⇪</span>
            <span>{uploading ? 'Uploading...' : 'Upload Photos'}</span>
          </span>
          <span className="fab-consent">Images are auto-cropped to square and vintage style</span>
        </label>
      </main>
    )
  }

  return (
    <main className="shell">
      {topRibbon}
      <section className="card intro-card">
        <p className="eyebrow">Shivani &amp; Nishant · 12 Dec 2026</p>
        <h1>Welcome to the Wedding Memory Wall</h1>
        <p className="hint intro-copy">
          Capture moments from Shivani &amp; Nishant’s day. Scan your family QR to join the live gallery and upload your photos instantly.
        </p>

        {error ? <p className="error">{error}</p> : null}

        <div className="intro-actions">
          <a className="primary gallery-nav-btn" href="/scan">Scan QR to Join</a>
          <button className="secondary" onClick={() => navigate('/scan')}>Enter code manually</button>
        </div>
        <p className="hint tiny">Admin? Open <a href="/admin/moderation">/admin/moderation</a></p>
      </section>
    </main>
  )
}

export default App
