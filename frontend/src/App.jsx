import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://disposable-camera-api.onrender.com"
const DEV_FALLBACK_QR_TOKEN = 'BALODHI-QR-2026'

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
  const [approvedItems, setApprovedItems] = useState([])
  const [adminSection, setAdminSection] = useState('approve')
  const [swipeHintSeen, setSwipeHintSeen] = useState(() => !!getStoredValue('swipe_hint_seen'))
  const [manualToken, setManualToken] = useState('')
  const [scanMessage, setScanMessage] = useState('')
  const [scannerBusy, setScannerBusy] = useState(false)

  const videoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const scannerLoopRef = useRef(null)
  const galleryRequestInFlightRef = useRef(false)
  const dragRafRef = useRef(null)
  const pendingDragXRef = useRef(0)

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
        <a className={`top-ribbon-link ${adminMode ? 'active' : ''}`} href="/admin/moderation">Admin</a>
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
      if (response.status === 401 && handleAdminAuthFailure(data, 'Failed to load pending photos')) {
        return
      }
      throw new Error(data?.message || 'Failed to load pending photos')
    }
    setPendingItems(data.items || [])
  }, [adminToken, handleAdminAuthFailure])

  const loadApproved = useCallback(async (tokenValue) => {
    const useToken = tokenValue || adminToken
    if (!useToken) {
      return
    }
    const response = await fetch(`${API_BASE_URL}/api/admin/photos/approved`, {
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
  }, [adminToken, handleAdminAuthFailure])

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
      loadPending(data.admin_token),
      loadUploadToggle(data.admin_token),
      loadApproved(data.admin_token),
    ])
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
      if (response.status === 401 && handleAdminAuthFailure(data, `Failed to ${action} photo`)) {
        return
      }
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
      if (response.status === 401 && handleAdminAuthFailure(data, 'Bulk approve failed')) {
        return
      }
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

  const deletePhoto = async (photoId) => {
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
    setAdminMessage('Photo removed from gallery')
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
        Promise.all([loadPending(adminToken), loadUploadToggle(adminToken), loadApproved(adminToken)]).catch((e) => {
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
  }, [token, adminMode, galleryMode, scanMode, introMode, adminToken, loadPending, loadUploadToggle, loadApproved, bootstrapFromQrToken])

  const adminLogout = () => {
    clearStoredValue('admin_token')
    setAdminToken('')
    setAdminPassword('')
    setAdminMessage('Logged out. Please login again.')
  }

  const loadGallery = useCallback(async () => {
    if (galleryRequestInFlightRef.current) {
      return
    }

    galleryRequestInFlightRef.current = true

    try {
      let activeSessionToken = sessionToken
      if (!activeSessionToken) {
        activeSessionToken = await bootstrapSessionFromSavedToken()
      }

      if (!activeSessionToken) {
        setGalleryMessage('Scan your family QR to start viewing and uploading photos.')
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

      const cappedItems = Array.isArray(data.items) ? data.items.slice(0, 200) : []
      setGalleryItems(cappedItems)
      setGalleryMessage('')
      setGalleryIndex((index) => {
        if (!cappedItems.length) return 0
        return index % cappedItems.length
      })
    } catch {
      setGalleryMessage('Unable to load gallery right now. Please retry in a moment.')
    } finally {
      galleryRequestInFlightRef.current = false
    }
  }, [sessionToken, bootstrapSessionFromSavedToken])

  useEffect(() => {
    if (!galleryMode) {
      return
    }

    loadGallery()
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadGallery()
      }
    }, 15000)
    return () => window.clearInterval(poll)
  }, [galleryMode, sessionToken, loadGallery])

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

    setUploading(true)
    setUploadJobs(imageFiles.map((f) => ({ name: f.name, status: 'pending', error: '' })))

    let doneCount = 0
    for (let i = 0; i < imageFiles.length; i++) {
      setUploadJobs((jobs) => jobs.map((j, idx) => idx === i ? { ...j, status: 'uploading' } : j))
      try {
        await uploadOne(imageFiles[i])
        doneCount++
        setUploadJobs((jobs) => jobs.map((j, idx) => idx === i ? { ...j, status: 'done' } : j))
      } catch (uploadError) {
        setUploadJobs((jobs) => jobs.map((j, idx) => idx === i ? { ...j, status: 'error', error: uploadError?.message || 'Failed' } : j))
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

  const visibleGalleryItems = useMemo(
    () => galleryItems.filter((item) => !brokenPhotoIds.includes(item.id)),
    [galleryItems, brokenPhotoIds]
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
    return () => {
      if (dragRafRef.current !== null) {
        window.cancelAnimationFrame(dragRafRef.current)
      }
    }
  }, [])

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
    if (comments[photoId]) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/photos/${photoId}/comments`, {
        headers: { 'x-session-token': tok },
      })
      const data = await res.json()
      if (res.ok) {
        setComments((prev) => ({ ...prev, [photoId]: data.comments || [] }))
      }
    } catch { /* silent */ }
  }, [sessionToken, comments])

  const openDrawer = (photoId) => {
    setDrawerPhotoId(photoId)
    setCommentText('')
    loadComments(photoId)
  }

  const closeDrawer = () => {
    if (drawerPhotoId) {
      setComments((prev) => {
        const next = { ...prev }
        delete next[drawerPhotoId]
        return next
      })
    }
    setDrawerPhotoId(null)
  }

  const submitQrToken = useCallback(async (providedToken) => {
    if (scannerBusy) {
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
      setScanMessage(scanError?.message || 'Token invalid. Please retry.')
      setScannerBusy(false)
    }
  }, [scannerBusy, bootstrapFromQrToken])

  useEffect(() => {
    if (!scanMode) {
      if (scannerLoopRef.current) {
        window.clearInterval(scannerLoopRef.current)
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

      if (!('BarcodeDetector' in window)) {
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
        scannerLoopRef.current = window.setInterval(async () => {
          if (!videoRef.current || scannerBusy) {
            return
          }
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
          }
        }, 700)
      } catch {
        setScanMessage('Camera permission denied. Enter token manually below.')
      }
    }

    setupScanner()

    return () => {
      mounted = false
      if (scannerLoopRef.current) {
        window.clearInterval(scannerLoopRef.current)
        scannerLoopRef.current = null
      }
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop())
        cameraStreamRef.current = null
      }
    }
  }, [scanMode, scannerBusy, submitQrToken])

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
                      <button className="primary small" onClick={() => loadPending()}>Refresh Pending</button>
                      <button className="primary small" disabled={!selectedIds.length} onClick={bulkApprove}>
                        Bulk Approve ({selectedIds.length})
                      </button>
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
                              loading="lazy"
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
                ) : null}

                {adminSection === 'delete' ? (
                  <>
                    <div className="admin-toolbar">
                      <button className="primary small" onClick={() => loadApproved()}>Refresh Approved</button>
                    </div>
                    <div className="moderation-grid">
                      {approvedItems.length === 0 ? <p className="hint">No approved photos.</p> : null}
                      {approvedItems.map((item) => (
                        <article key={item.id} className="moderation-item">
                          <p className="hint">
                            #{item.id} {item.family_name} {item.guest_name ? `• ${item.guest_name}` : ''}
                          </p>
                          {(item.filtered_url || item.original_url) ? (
                            <img
                              src={item.filtered_url || item.original_url}
                              alt="approved photo"
                              className="mod-thumb"
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.display = 'none' }}
                              draggable={false}
                            />
                          ) : (
                            <div className="mod-thumb mod-thumb-empty" />
                          )}
                          <div className="admin-actions">
                            <button className="danger small" onClick={() => deletePhoto(item.id)}>Delete from Gallery</button>
                          </div>
                        </article>
                      ))}
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
                      }}>
                        Refresh All Data
                      </button>
                      {import.meta.env.DEV ? <button className="primary small" onClick={seedDemoApprovedPhoto}>Seed Demo Photo</button> : null}
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
          <p className="eyebrow">Shivani &amp; Nishant · 12 Dec 2026</p>
          <h1>The Wedding Album 📸</h1>
          {!sessionToken ? (
            <p className="error">Scan your family QR to continue.</p>
          ) : null}
          {galleryMessage ? <p className="upload-note">{galleryMessage}</p> : null}

          {uploadJobs.length > 0 ? (
            <ul className="upload-progress-list">
              {uploadJobs.map((job, idx) => (
                <li key={idx} className={`upload-job upload-job--${job.status}`}>
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
          ) : null}

          {visibleGalleryItems.length > 0 ? (
            <p className="photo-counter">{(galleryIndex % visibleGalleryItems.length) + 1} / {visibleGalleryItems.length}</p>
          ) : null}
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

        <label className={`upload-fab gallery-upload-fab ${!sessionToken || uploading ? 'disabled' : ''}`}>
          <input
            type="file"
            accept="image/*"
            multiple
            disabled={!sessionToken || uploading}
            onChange={onFilesSelected}
          />
          {uploading ? 'Uploading...' : 'Upload Photos +'}
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
