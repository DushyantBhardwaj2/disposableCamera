import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://disposable-camera-api.onrender.com"
const DEV_FALLBACK_QR_TOKEN = 'BALODHI-QR-2026'

const parseTokenFromPath = (pathname) => {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length === 2 && parts[0] === 'f') {
    return parts[1]
  }
  return ''
}

const isAdminRoute = (pathname) => pathname.startsWith('/admin/moderation')
const isGalleryRoute = (pathname) => pathname.startsWith('/gallery')

const getStoredValue = (key) => {
  return window.sessionStorage.getItem(key) || window.localStorage.getItem(key) || ''
}

const setStoredValue = (key, value) => {
  window.sessionStorage.setItem(key, value)
  window.localStorage.setItem(key, value)
}

function App() {
  const pathname = window.location.pathname
  const adminMode = useMemo(() => isAdminRoute(pathname), [pathname])
  const galleryMode = useMemo(() => isGalleryRoute(pathname), [pathname])
  const token = useMemo(() => parseTokenFromPath(window.location.pathname), [])
  const [family, setFamily] = useState(null)
  const [guestName, setGuestName] = useState('')
  const [sessionToken, setSessionToken] = useState(() => getStoredValue('guest_session_token'))
  const [loading, setLoading] = useState(true)
  const [startingSession, setStartingSession] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [adminToken, setAdminToken] = useState(() => getStoredValue('admin_token'))
  const [pendingItems, setPendingItems] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [adminMessage, setAdminMessage] = useState('')
  const [uploadEnabled, setUploadEnabled] = useState(true)
  const [galleryItems, setGalleryItems] = useState([])
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [galleryMessage, setGalleryMessage] = useState('')
  const dragOriginRef = useRef(null)
  const wasDragRef = useRef(false)
  const [dragX, setDragX] = useState(null)
  const [flyDir, setFlyDir] = useState(null)
  const [brokenPhotoIds, setBrokenPhotoIds] = useState([])
  const [drawerPhotoId, setDrawerPhotoId] = useState(null)
  const [comments, setComments] = useState({})
  const [commentText, setCommentText] = useState('')
  const [lightboxUrl, setLightboxUrl] = useState(null)
  const [uploadJobs, setUploadJobs] = useState([])
  const [newFamilyName, setNewFamilyName] = useState('')
  const [newFamilySlug, setNewFamilySlug] = useState('')
  const [newFamilyToken, setNewFamilyToken] = useState('')
  const [creatingFamily, setCreatingFamily] = useState(false)

  useEffect(() => {
    // Warm up Render on first page load to reduce cold-start delay for user actions.
    fetch(`${API_BASE_URL}/api/health`).catch(() => {})
  }, [])

  const activeGuestToken = token || getStoredValue('family_qr_token') || DEV_FALLBACK_QR_TOKEN
  const guestHref = `/f/${encodeURIComponent(activeGuestToken)}`
  const topRibbon = (
    <nav className="top-ribbon">
      <div className="top-ribbon-inner">
        <a className={`top-ribbon-link ${!adminMode && !galleryMode ? 'active' : ''}`} href={guestHref}>Guest</a>
        <a className={`top-ribbon-link ${adminMode ? 'active' : ''}`} href="/admin/moderation">Admin</a>
        <a className={`top-ribbon-link ${galleryMode ? 'active' : ''}`} href="/gallery">Gallery</a>
      </div>
    </nav>
  )

  const bootstrapSessionFromSavedToken = useCallback(async () => {
    const savedQrToken = getStoredValue('family_qr_token')
    const qrTokenToUse = savedQrToken || (import.meta.env.DEV ? DEV_FALLBACK_QR_TOKEN : '')
    if (!qrTokenToUse) {
      return null
    }

    if (!savedQrToken && qrTokenToUse) {
      setStoredValue('family_qr_token', qrTokenToUse)
    }

    const response = await fetch(`${API_BASE_URL}/api/session/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ qr_token: qrTokenToUse, guest_name: '' }),
    })
    const data = await response.json()
    if (!response.ok || !data?.session_token) {
      return null
    }

    setSessionToken(data.session_token)
    setStoredValue('guest_session_token', data.session_token)
    return data.session_token
  }, [])

  const loadPending = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/photos/pending`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data?.message || 'Failed to load pending photos')
    }
    setPendingItems(data.items || [])
  }, [adminToken])

  const loadUploadToggle = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/upload-toggle`, {
      headers: { Authorization: `Bearer ${useToken}` },
    })
    const data = await response.json()
    if (response.ok) {
      setUploadEnabled(Boolean(data.upload_enabled))
    }
  }, [adminToken])

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
    await Promise.all([loadPending(data.admin_token), loadUploadToggle(data.admin_token)])
    setAdminMessage('Admin login successful')
  }

  const moderateOne = async (photoId, action) => {
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
      setAdminMessage(data?.message || `Failed to ${action} photo`)
      return
    }
    setPendingItems((items) => items.filter((x) => x.id !== photoId))
    setSelectedIds((ids) => ids.filter((x) => x !== photoId))
    setAdminMessage(`Photo ${action}d`)
  }

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
      setAdminMessage(data?.message || 'Bulk approve failed')
      return
    }
    setPendingItems((items) => items.filter((x) => !selectedIds.includes(x.id)))
    setSelectedIds([])
    setAdminMessage(`Approved ${data.updated} photo(s)`)
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
        Promise.all([loadPending(adminToken), loadUploadToggle(adminToken)]).catch((e) => {
          setAdminMessage(e?.message || 'Unable to load moderation data')
        })
      }
      return
    }

    if (galleryMode) {
      setLoading(false)
      return
    }

    const validateToken = async () => {
      if (!token) {
        setError('This page requires a valid family QR link. Use /f/{token}.')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`${API_BASE_URL}/api/token/validate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ qr_token: token }),
        })

        const data = await response.json()
        if (!response.ok) {
          setError(data?.message || 'Unable to validate QR token.')
        } else {
          setFamily(data.family)
          setStoredValue('family_qr_token', token)
        }
      } catch {
        setError('Cannot reach API server. Start the backend and try again.')
      } finally {
        setLoading(false)
      }
    }

    validateToken()
  }, [token, adminMode, galleryMode, adminToken, loadPending, loadUploadToggle])

  const loadGallery = useCallback(async () => {
    let activeSessionToken = sessionToken
    if (!activeSessionToken) {
      activeSessionToken = await bootstrapSessionFromSavedToken()
    }

    if (!activeSessionToken) {
      setGalleryMessage('Start a guest session first via your family QR link.')
      return
    }

    const response = await fetch(`${API_BASE_URL}/api/gallery/approved`, {
      headers: { 'x-session-token': activeSessionToken },
    })
    const data = await response.json()
    if (!response.ok) {
      setGalleryMessage(data?.message || 'Unable to load gallery')
      return
    }
    setGalleryItems(data.items || [])
    setGalleryMessage('')
  }, [sessionToken, bootstrapSessionFromSavedToken])

  useEffect(() => {
    if (!galleryMode) {
      return
    }

    loadGallery()
    const poll = window.setInterval(loadGallery, 15000)
    return () => window.clearInterval(poll)
  }, [galleryMode, sessionToken, loadGallery])

  const startSession = async () => {
    setStartingSession(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE_URL}/api/session/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ qr_token: token, guest_name: guestName.trim() }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data?.message || 'Could not start guest session.')
        return
      }

      setSessionToken(data.session_token)
      setStoredValue('guest_session_token', data.session_token)
      setStoredValue('family_qr_token', token)
    } catch {
      setError('Cannot start session right now. Please retry.')
    } finally {
      setStartingSession(false)
    }
  }

  const blobToBase64 = async (blob) => {
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  const compressImage = async (file) => {
    const imageUrl = URL.createObjectURL(file)
    const image = new Image()

    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = imageUrl
    })

    const maxWidth = 1600
    const ratio = Math.min(1, maxWidth / image.width)
    const width = Math.round(image.width * ratio)
    const height = Math.round(image.height * ratio)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Image processing failed')
    }

    // Disposable camera style treatment.
    context.filter = 'contrast(1.15) saturate(1.08) sepia(0.18)'
    context.drawImage(image, 0, 0, width, height)

    const gradient = context.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.25,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7
    )
    gradient.addColorStop(0, 'rgba(255,200,120,0.04)')
    gradient.addColorStop(1, 'rgba(20,12,6,0.22)')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)

    URL.revokeObjectURL(imageUrl)

    const compressedBlob = await new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.75)
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

    setUploading(true)
    setUploadJobs(files.map((f) => ({ name: f.name, status: 'pending', error: '' })))

    let doneCount = 0
    for (let i = 0; i < files.length; i++) {
      setUploadJobs((jobs) => jobs.map((j, idx) => idx === i ? { ...j, status: 'uploading' } : j))
      try {
        await uploadOne(files[i])
        doneCount++
        setUploadJobs((jobs) => jobs.map((j, idx) => idx === i ? { ...j, status: 'done' } : j))
      } catch (uploadError) {
        setUploadJobs((jobs) => jobs.map((j, idx) => idx === i ? { ...j, status: 'error', error: uploadError?.message || 'Failed' } : j))
      }
    }

    setUploading(false)
    setUploadMessage(doneCount ? `${doneCount} photo(s) uploaded. Pending moderation.` : 'Upload failed.')
    event.target.value = ''
  }

  const visibleGalleryItems = galleryItems.filter((item) => !brokenPhotoIds.includes(item.id))
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
    if (Math.abs(dx) > 6) wasDragRef.current = true
    setDragX(dx)
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

  const loadComments = useCallback(async (photoId) => {
    const tok = sessionToken
    if (!tok) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/photos/${photoId}/comments`, {
        headers: { 'x-session-token': tok },
      })
      const data = await res.json()
      if (res.ok) {
        setComments((prev) => ({ ...prev, [photoId]: data.comments || [] }))
      }
    } catch { /* silent */ }
  }, [sessionToken])

  const openDrawer = (photoId) => {
    setDrawerPhotoId(photoId)
    setCommentText('')
    loadComments(photoId)
  }

  const closeDrawer = () => setDrawerPhotoId(null)

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

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setLightboxUrl(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading) {
    return (
      <main className="shell">
        {topRibbon}
        <section className="card">
          <h1>Checking your QR link...</h1>
        </section>
      </main>
    )
  }

  if (adminMode) {
    return (
      <main className="shell admin-shell">
        {topRibbon}
        <section className="card admin-card">
          <p className="eyebrow">Milestone 4</p>
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
            <>
              <div className="admin-toolbar">
                <button className="primary small" onClick={() => loadPending()}>Refresh</button>
                <button className="primary small" disabled={!selectedIds.length} onClick={bulkApprove}>
                  Bulk Approve ({selectedIds.length})
                </button>
                <button className="primary small" onClick={() => setUploadsEnabled(!uploadEnabled)}>
                  Uploads: {uploadEnabled ? 'ON' : 'OFF'}
                </button>
                <button className="primary small" onClick={seedDemoApprovedPhoto}>Seed Demo Photo</button>
              </div>

              <div className="family-create">
                <h2 className="section-heading">Add New Family</h2>
                <div className="family-create-grid">
                  <input className="name-input" placeholder="Family name *" value={newFamilyName} onChange={(e) => setNewFamilyName(e.target.value)} />
                  <input className="name-input" placeholder="Slug (optional, auto-generated)" value={newFamilySlug} onChange={(e) => setNewFamilySlug(e.target.value)} />
                  <input className="name-input" placeholder="QR token (optional, auto-generated)" value={newFamilyToken} onChange={(e) => setNewFamilyToken(e.target.value)} />
                  <button className="primary small" disabled={!newFamilyName.trim() || creatingFamily} onClick={createFamily}>
                    {creatingFamily ? 'Creating…' : 'Create Family'}
                  </button>
                </div>
              </div>

              <div className="moderation-grid">
                {pendingItems.length === 0 ? <p className="hint">No pending photos.</p> : null}
                {pendingItems.map((item) => (
                  <article key={item.id} className="moderation-item">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) => {
                          if (event.target.checked) {
                            setSelectedIds((ids) => [...ids, item.id])
                          } else {
                            setSelectedIds((ids) => ids.filter((id) => id !== item.id))
                          }
                        }}
                      />
                      Photo #{item.id}
                    </label>
                    <p className="hint">
                      {item.family_name} {item.guest_name ? `• ${item.guest_name}` : ''}
                    </p>
                    {(item.filtered_url || item.original_url) ? (
                      <img
                        src={item.filtered_url || item.original_url}
                        alt="pending photo thumbnail"
                        className="mod-thumb"
                        onError={(e) => { e.currentTarget.style.display = 'none' }}
                        draggable={false}
                      />
                    ) : (
                      <div className="mod-thumb mod-thumb-empty" />
                    )}
                    <div className="admin-actions">
                      <button className="primary small" onClick={() => moderateOne(item.id, 'approve')}>Approve</button>
                      <button className="danger small" onClick={() => moderateOne(item.id, 'reject')}>Reject</button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}

          {adminMessage ? <p className="upload-note">{adminMessage}</p> : null}
        </section>
      </main>
    )
  }

  if (galleryMode) {
    const cardComments = drawerPhotoId ? (comments[drawerPhotoId] || []) : []

    return (
      <main className="shell gallery-shell">
        {topRibbon}
        {lightboxUrl ? (
          <div className="lightbox" onClick={() => setLightboxUrl(null)}>
            <button className="lightbox-close" onClick={() => setLightboxUrl(null)} aria-label="Close">✕</button>
            <img src={lightboxUrl} alt="Full size" className="lightbox-img" draggable={false} />
          </div>
        ) : null}

        <section className="card gallery-card">
          <p className="eyebrow">Live Gallery</p>
          <h1>Swipe Through Approved Photos</h1>
          {!sessionToken ? (
            <p className="error">Start a guest session first via your family QR link.</p>
          ) : null}
          {galleryMessage ? <p className="upload-note">{galleryMessage}</p> : null}

          {currentCard ? (
            <article
              className="swipe-card"
              style={cardDragStyle}
              onPointerDown={onCardPointerDown}
              onPointerMove={onCardPointerMove}
              onPointerUp={onCardPointerUp}
              onPointerCancel={onCardPointerCancel}
            >
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
                  💬 {(comments[currentCard.id] || []).length || ''}
                </button>
              </div>
              <div className="swipe-actions">
                <button className="danger small" onClick={() => triggerFly('skip')}>Skip</button>
                <button className="primary small" onClick={() => triggerFly('like')}>Like</button>
                <button className="primary small" onClick={() => triggerFly('superlike')}>Super</button>
              </div>
              <p className="tiny hint">Drag or swipe to react • tap image to expand.</p>

              {drawerPhotoId === currentCard.id ? (
                <div className="comment-drawer">
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
            <p className="hint">No approved photos yet. Ask moderators to approve pending uploads.</p>
          )}
        </section>
      </main>
    )
  }

  return (
    <main className="shell">
      {topRibbon}
      <section className="card">
        <p className="eyebrow">Milestone 1 + 2</p>
        <h1>Wedding Photo Guest Entry</h1>

        {error ? (
          <p className="error">{error}</p>
        ) : family ? (
          <>
            <p className="hint">Welcome {family.name}. Enter your name (optional) to start.</p>
            <input
              value={guestName}
              onChange={(event) => setGuestName(event.target.value)}
              maxLength={60}
              placeholder="Your name (optional)"
              className="name-input"
            />
            <button className="primary" onClick={startSession} disabled={startingSession || !!sessionToken}>
              {sessionToken ? 'Session Started' : startingSession ? 'Starting...' : 'Start Session'}
            </button>
          </>
        ) : null}

        <div className="status-grid">
          <div>
            <span className="label">Family Token</span>
            <span className="value">{token || 'N/A'}</span>
          </div>
          <div>
            <span className="label">Family</span>
            <span className="value">{family?.name || 'Not validated'}</span>
          </div>
          <div>
            <span className="label">Session</span>
            <span className="value">{sessionToken ? 'Active' : 'Not started'}</span>
          </div>
        </div>

        {sessionToken ? (
          <>
            <p className="success">Session token stored. Milestone 2 guest access flow is working.</p>
            {uploadJobs.length > 0 ? (
              <ul className="upload-progress-list">
                {uploadJobs.map((job, idx) => (
                  <li key={idx} className={`upload-job upload-job--${job.status}`}>
                    <span className="upload-job-name">{job.name}</span>
                    <span className="upload-job-status">
                      {job.status === 'pending' && '⏳ Waiting'}
                      {job.status === 'uploading' && '⬆️ Uploading…'}
                      {job.status === 'done' && '✅ Done'}
                      {job.status === 'error' && `❌ ${job.error}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : uploadMessage ? <p className="upload-note">{uploadMessage}</p> : null}
            <a className="gallery-link" href="/gallery">Open Swipe Gallery</a>
          </>
        ) : null}
      </section>

      <label className={`upload-fab ${!sessionToken || uploading ? 'disabled' : ''}`}>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={!sessionToken || uploading}
          onChange={onFilesSelected}
        />
        {uploading ? 'Uploading...' : 'Upload Photos'}
      </label>
    </main>
  )
}

export default App
