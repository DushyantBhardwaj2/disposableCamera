import 'dotenv/config'
import cors from 'cors'
import Database from 'better-sqlite3'
import express, { Request, Response } from 'express'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

type JsonValue = string | number | boolean | null | JsonObject | JsonValue[]
interface JsonObject {
  [key: string]: JsonValue
}

type GuestSession = {
  id: number
  family_id: number
  display_name: string | null
  session_token: string
  expires_at: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dataDir = path.join(rootDir, 'data')
const renderDiskPath = String(process.env.RENDER_DISK_PATH || '').trim()
const sqlitePathInput = String(process.env.SQLITE_PATH || '').trim()

fs.mkdirSync(dataDir, { recursive: true })

const resolveDbPath = () => {
  if (sqlitePathInput) {
    if (path.isAbsolute(sqlitePathInput)) {
      return sqlitePathInput
    }
    // If Render disk exists, place relative sqlite path on persistent storage.
    if (renderDiskPath) {
      return path.join(renderDiskPath, sqlitePathInput.replace(/^\.\//, ''))
    }
    return path.resolve(rootDir, sqlitePathInput)
  }

  if (renderDiskPath) {
    return path.join(renderDiskPath, 'wedding.db')
  }

  return path.join(dataDir, 'wedding.db')
}

const dbPath = resolveDbPath()
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const PORT = Number(process.env.PORT || 8787)
const signingSecret = process.env.UPLOAD_SIGNING_SECRET || 'local-dev-signing-secret'
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024)
const slowRequestWarnMs = Number(process.env.SLOW_REQUEST_WARN_MS || 900)
const s3Bucket = process.env.S3_BUCKET || ''
const s3Region = process.env.S3_REGION || 'ap-south-1'
const s3Endpoint = process.env.S3_ENDPOINT || undefined
const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === '1'
const allowedUploadMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

type RateLimitBucket = {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitBucket>()
const telemetryCounters = new Map<string, number>()

const bumpTelemetry = (key: string) => {
  const normalized = String(key || '').trim().slice(0, 120)
  if (!normalized) {
    return
  }
  telemetryCounters.set(normalized, Number(telemetryCounters.get(normalized) || 0) + 1)
}

const normalizeTelemetryPath = (pathValue: string) => {
  return String(pathValue || '')
    .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id')
}

const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

const s3Client = s3Bucket
  ? new S3Client({
      region: s3Region,
      endpoint: s3Endpoint,
      forcePathStyle: s3ForcePathStyle,
    })
  : null

const app = express()

const allowedProdOrigins = new Set([
  'https://disposable-camera-89a02.web.app',
  'https://disposable-camera-89a02.firebaseapp.com',
])

const isDevelopment = process.env.NODE_ENV !== 'production'
const devOriginRegex = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow non-browser/server-to-server requests with no Origin header.
      if (!origin) {
        return callback(null, true)
      }

      if (allowedProdOrigins.has(origin)) {
        return callback(null, true)
      }

      if (isDevelopment && devOriginRegex.test(origin)) {
        return callback(null, true)
      }

      return callback(new Error('Not allowed by CORS'))
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-session-token', 'x-admin-token'],
  })
)
app.use(express.json({ limit: '20mb' }))

app.use((req, res, next) => {
  const startedAt = Date.now()
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) {
      return
    }

    const normalizedPath = normalizeTelemetryPath(req.path)
    const routeKey = `${req.method.toLowerCase()}_${normalizedPath}`
    const durationMs = Date.now() - startedAt

    bumpTelemetry(`api_route_${routeKey}`)

    let latencyBucket = 'fast'
    if (durationMs >= 2000) {
      latencyBucket = 'over_2000ms'
    } else if (durationMs >= 1000) {
      latencyBucket = '1000_to_1999ms'
    } else if (durationMs >= 500) {
      latencyBucket = '500_to_999ms'
    } else if (durationMs >= 200) {
      latencyBucket = '200_to_499ms'
    }
    bumpTelemetry(`api_latency_${latencyBucket}_${routeKey}`)

    if (durationMs >= slowRequestWarnMs) {
      bumpTelemetry('api_slow_request')
      console.warn(
        `[api-latency] ${req.method} ${req.originalUrl} status=${res.statusCode} duration_ms=${durationMs} ip=${
          req.ip || 'unknown'
        }`
      )
    }
  })
  next()
})

const applyMigrations = () => {
  const migrationDir = path.join(rootDir, 'migrations')
  if (!fs.existsSync(migrationDir)) {
    return
  }

  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  for (const fileName of files) {
    const sql = fs.readFileSync(path.join(migrationDir, fileName), 'utf8')
    try {
      db.exec(sql)
    } catch (error) {
      const message = String((error as Error)?.message || '').toLowerCase()
      // Allow idempotent re-runs for ALTER TABLE ADD COLUMN migrations.
      if (message.includes('duplicate column name')) {
        continue
      }
      throw error
    }
  }
}

const json = (res: Response, data: JsonValue, status = 200) => {
  res.status(status).json(data)
}

const errorJson = (res: Response, error: string, message: string, status: number) => {
  json(res, { error, message }, status)
}

const escapeSqlLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

const parseDateFilter = (value: unknown) => {
  const trimmed = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : ''
}

const generateToken = () => {
  return `sess_${crypto.randomUUID().replace(/-/g, '')}`
}

const getExpiryIso = (hours: number) => {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
}

const base64UrlEncode = (text: string) => {
  return Buffer.from(text, 'utf8').toString('base64url')
}

const base64UrlDecode = (encoded: string) => {
  return Buffer.from(encoded, 'base64url').toString('utf8')
}

const signPayload = (payload: Record<string, unknown>) => {
  const encoded = base64UrlEncode(JSON.stringify(payload))
  const signature = crypto.createHmac('sha256', signingSecret).update(encoded).digest('base64url')
  return `v1.${encoded}.${signature}`
}

const verifySignedPayload = (token: string) => {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') {
    return null
  }

  const [, encodedPayload, providedSig] = parts
  const expectedSig = crypto.createHmac('sha256', signingSecret).update(encodedPayload).digest('base64url')

  const a = Buffer.from(providedSig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as Record<string, unknown>
    return payload
  } catch {
    return null
  }
}

const getSessionTokenFromRequest = (request: Request, bodyToken?: string) => {
  const headerToken = request.header('x-session-token')?.trim()
  if (headerToken) {
    return headerToken
  }

  const auth = request.header('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }

  return bodyToken?.trim() || ''
}

const getAdminTokenFromRequest = (request: Request, bodyToken?: string) => {
  const headerToken = request.header('x-admin-token')?.trim()
  if (headerToken) {
    return headerToken
  }

  const auth = request.header('authorization') || ''
  if (auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }

  return bodyToken?.trim() || ''
}

const findFamilyByToken = (qrToken: string) => {
  const row = db
    .prepare(
      `SELECT id, name, slug, qr_token, is_active
       FROM families
       WHERE qr_token = ? AND is_active = 1
       LIMIT 1`
    )
    .get(qrToken) as
    | { id: number; name: string; slug: string; qr_token: string; is_active: number }
    | undefined

  return row || null
}

const requireSession = (request: Request, bodyToken?: string) => {
  const token = getSessionTokenFromRequest(request, bodyToken)
  if (!token) {
    return { ok: false as const, response: (res: Response) => errorJson(res, 'missing_session', 'session token is required', 401) }
  }

  const session = db
    .prepare(
      `SELECT id, family_id, display_name, session_token, expires_at
       FROM guest_sessions
       WHERE session_token = ?
       LIMIT 1`
    )
    .get(token) as GuestSession | undefined

  if (!session) {
    return { ok: false as const, response: (res: Response) => errorJson(res, 'invalid_session', 'Session not found', 401) }
  }

  if (new Date(session.expires_at).getTime() < Date.now()) {
    return { ok: false as const, response: (res: Response) => errorJson(res, 'expired_session', 'Session has expired', 401) }
  }

  return { ok: true as const, session }
}

const createAdminToken = () => {
  return signPayload({ role: 'admin', expires_at: getExpiryIso(8) })
}

const verifyAdminToken = (token: string) => {
  const payload = verifySignedPayload(token)
  if (!payload) {
    return false
  }
  if (payload.role !== 'admin') {
    return false
  }
  const exp = typeof payload.expires_at === 'string' ? payload.expires_at : ''
  return !!exp && new Date(exp).getTime() > Date.now()
}

const requireAdmin = (request: Request, bodyToken?: string) => {
  const token = getAdminTokenFromRequest(request, bodyToken)
  if (!token) {
    return { ok: false as const, response: (res: Response) => errorJson(res, 'missing_admin', 'Admin token is required', 401) }
  }

  if (!verifyAdminToken(token)) {
    return { ok: false as const, response: (res: Response) => errorJson(res, 'invalid_admin', 'Invalid or expired admin token', 401) }
  }

  return { ok: true as const }
}

const getUploadEnabled = () => {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'upload_enabled' LIMIT 1").get() as
    | { value: string }
    | undefined
  return row ? row.value === '1' : true
}

const extensionFromType = (fileName: string, fileType: string) => {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'jpg'
  if (lowerName.endsWith('.png')) return 'png'
  if (lowerName.endsWith('.webp')) return 'webp'
  if (lowerName.endsWith('.gif')) return 'gif'

  const lowerType = fileType.toLowerCase()
  if (lowerType.includes('jpeg')) return 'jpg'
  if (lowerType.includes('png')) return 'png'
  if (lowerType.includes('webp')) return 'webp'
  if (lowerType.includes('gif')) return 'gif'
  return 'jpg'
}

const toPublicMediaUrl = (origin: string, rawUrl: string | null) => {
  if (!rawUrl) {
    return null
  }

  const asKey = (prefix: string) => {
    const key = rawUrl.slice(prefix.length)
    return `${origin}/api/media?key=${encodeURIComponent(key)}`
  }

  if (rawUrl.startsWith('s3://')) {
    return asKey('s3://')
  }

  if (rawUrl.startsWith('r2://')) {
    return asKey('r2://')
  }

  if (rawUrl.startsWith('local://uploads/')) {
    return asKey('local://uploads/')
  }

  return rawUrl
}

const readBodyToBuffer = async (body: unknown): Promise<Buffer> => {
  if (!body) {
    return Buffer.alloc(0)
  }

  if (Buffer.isBuffer(body)) {
    return body
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body)
  }

  if (typeof body === 'string') {
    return Buffer.from(body)
  }

  if (body instanceof Readable) {
    const chunks: Buffer[] = []
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return Buffer.concat(chunks)
  }

  if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
    const arr = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
    return Buffer.from(arr)
  }

  return Buffer.alloc(0)
}

const requireS3 = (res: Response) => {
  if (!s3Client || !s3Bucket) {
    errorJson(res, 'storage_unavailable', 'S3 is not configured. Set S3_BUCKET and AWS credentials.', 503)
    return false
  }
  return true
}

const getRequestIp = (req: Request) => {
  const xff = String(req.headers['x-forwarded-for'] || '').trim()
  if (xff) {
    return xff.split(',')[0].trim()
  }
  return req.ip || req.socket.remoteAddress || 'unknown'
}

const enforceRateLimit = (
  req: Request,
  res: Response,
  key: string,
  maxRequests: number,
  windowMs: number
) => {
  const now = Date.now()
  const bucketKey = `${key}:${getRequestIp(req)}`
  const current = rateLimitStore.get(bucketKey)

  if (!current || now >= current.resetAt) {
    rateLimitStore.set(bucketKey, { count: 1, resetAt: now + windowMs })
    return true
  }

  if (current.count >= maxRequests) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
    res.setHeader('retry-after', String(retryAfter))
    errorJson(res, 'rate_limited', `Too many requests. Retry in ${retryAfter} seconds.`, 429)
    return false
  }

  current.count += 1
  return true
}

const ensurePhotoInFamily = (photoId: number, familyId: number) => {
  const row = db
    .prepare(
      `SELECT id
       FROM photos
       WHERE id = ? AND family_id = ? AND status = 'approved' AND is_deleted = 0
       LIMIT 1`
    )
    .get(photoId, familyId) as { id: number } | undefined

  return !!row
}

applyMigrations()

app.get(['/', '/api'], (_req, res) => {
  json(res, {
    service: 'wedding-photo-api',
    status: 'ok',
    routes: [
      'GET /api/health',
      'POST /api/token/validate',
      'POST /api/session/start',
      'POST /api/uploads/sign',
      'POST /api/uploads/direct',
      'POST /api/photos/register',
      'GET /api/gallery/approved',
      'POST /api/photos/:id/reaction',
      'GET /api/photos/:id/comments',
      'POST /api/photos/:id/comments',
      'POST /api/admin/login',
      'GET /api/admin/photos/pending',
      'POST /api/admin/photos/:id/approve',
      'POST /api/admin/photos/:id/reject',
      'POST /api/admin/photos/bulk-approve',
      'POST /api/admin/photos/bulk-reject',
      'GET /api/admin/photos/approved',
      'POST /api/admin/photos/:id/delete',
      'GET /api/admin/upload-toggle',
      'POST /api/admin/upload-toggle',
      'GET /api/admin/families',
      'GET /api/admin/telemetry/summary',
      'POST /api/admin/telemetry/reset',
      'GET /api/admin/health-snapshot',
      'POST /api/admin/families/create',
      'POST /api/dev/seed-approved',
    ],
  })
})

app.get('/api/health', (_req, res) => {
  json(res, { status: 'ok', service: 'wedding-photo-api' })
})

app.post('/api/telemetry/client', (req, res) => {
  if (!enforceRateLimit(req, res, 'client_telemetry', 80, 60_000)) {
    return
  }

  const eventName = String(req.body?.event || '').trim().slice(0, 80)
  if (!eventName) {
    return errorJson(res, 'missing_event', 'event is required', 400)
  }

  const detailsRaw = req.body?.details
  let details: Record<string, unknown> = {}
  if (detailsRaw && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)) {
    details = detailsRaw as Record<string, unknown>
  }

  console.warn(
    `[client-telemetry] event=${eventName} ip=${req.ip || 'unknown'} details=${JSON.stringify(details).slice(0, 1200)}`
  )
  bumpTelemetry(`client_${eventName}`)

  return json(res, { ok: true })
})

app.get('/api/admin/telemetry/summary', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }

  const allCounters = Array.from(telemetryCounters.entries())
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count)

  const counters = allCounters.slice(0, 50)
  const routeHits = allCounters.filter((item) => item.event.startsWith('api_route_')).slice(0, 30)
  const latencyBuckets = allCounters.filter((item) => item.event.startsWith('api_latency_')).slice(0, 30)
  const clientEvents = allCounters.filter((item) => item.event.startsWith('client_')).slice(0, 30)
  const other = allCounters
    .filter(
      (item) =>
        !item.event.startsWith('api_route_') && !item.event.startsWith('api_latency_') && !item.event.startsWith('client_')
    )
    .slice(0, 30)

  const sumCounts = (items: Array<{ count: number }>) => items.reduce((acc, item) => acc + Number(item.count || 0), 0)

  return json(res, {
    now: new Date().toISOString(),
    counters,
    groups: {
      route_hits: routeHits,
      latency_buckets: latencyBuckets,
      client_events: clientEvents,
      other,
    },
    totals: {
      route_hits: sumCounts(routeHits),
      latency_events: sumCounts(latencyBuckets),
      client_events: sumCounts(clientEvents),
      other_events: sumCounts(other),
    },
  })
})

app.post('/api/admin/telemetry/reset', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }
  const countBefore = telemetryCounters.size
  telemetryCounters.clear()
  console.warn(`[telemetry-reset] cleared ${countBefore} counters ip=${req.ip || 'unknown'}`)
  return json(res, { ok: true, cleared: countBefore })
})

app.get('/api/admin/families', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }

  const rows = db
    .prepare(
      `SELECT id, name, slug, qr_token, is_active
       FROM families
       ORDER BY name ASC`
    )
    .all() as Array<{ id: number; name: string; slug: string; qr_token: string; is_active: number }>

  return json(res, { families: rows })
})

app.get('/api/admin/health-snapshot', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }

  let dbFileSizeBytes = 0
  try {
    dbFileSizeBytes = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0
  } catch {
    dbFileSizeBytes = 0
  }

  const pendingCount = Number(
    (db.prepare("SELECT COUNT(1) AS total FROM photos WHERE status = 'pending' AND is_deleted = 0").get() as { total: number } | undefined)
      ?.total || 0
  )
  const approvedCount = Number(
    (db.prepare("SELECT COUNT(1) AS total FROM photos WHERE status = 'approved' AND is_deleted = 0").get() as { total: number } | undefined)
      ?.total || 0
  )
  const familyCount = Number(
    (db.prepare('SELECT COUNT(1) AS total FROM families').get() as { total: number } | undefined)?.total || 0
  )
  const activeSessionCount = Number(
    (
      db
        .prepare('SELECT COUNT(1) AS total FROM guest_sessions WHERE datetime(expires_at) > datetime(\'now\')')
        .get() as { total: number } | undefined
    )?.total || 0
  )

  const telemetryEventCount = Array.from(telemetryCounters.values()).reduce((sum, count) => sum + Number(count || 0), 0)

  return json(res, {
    now: new Date().toISOString(),
    status: {
      db_ok: true,
      s3_configured: Boolean(s3Client && s3Bucket),
      upload_enabled: getUploadEnabled(),
    },
    counts: {
      families: familyCount,
      pending_photos: pendingCount,
      approved_photos: approvedCount,
      active_sessions: activeSessionCount,
      telemetry_events: telemetryEventCount,
    },
    storage: {
      db_file_size_bytes: dbFileSizeBytes,
      db_file_size_mb: Number((dbFileSizeBytes / (1024 * 1024)).toFixed(2)),
    },
  })
})

app.post('/api/token/validate', (req, res) => {
  const qrToken = String(req.body?.qr_token || '').trim()
  if (!qrToken) {
    return errorJson(res, 'missing_token', 'qr_token is required', 400)
  }

  const family = findFamilyByToken(qrToken)
  if (!family) {
    return errorJson(res, 'invalid_token', 'QR token not found or inactive', 404)
  }

  return json(res, { family })
})

app.post('/api/session/start', (req, res) => {
  const qrToken = String(req.body?.qr_token || '').trim()
  const guestNameRaw = String(req.body?.guest_name || '').trim()
  const guestName = guestNameRaw.slice(0, 60)

  if (!qrToken) {
    return errorJson(res, 'missing_token', 'qr_token is required', 400)
  }

  const family = findFamilyByToken(qrToken)
  if (!family) {
    return errorJson(res, 'invalid_token', 'QR token not found or inactive', 404)
  }

  const sessionToken = generateToken()
  const expiresAt = getExpiryIso(24)

  const insert = db
    .prepare(
      `INSERT INTO guest_sessions (family_id, display_name, session_token, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(family.id, guestName || null, sessionToken, expiresAt)

  if (!insert.lastInsertRowid) {
    return errorJson(res, 'db_error', 'Could not create guest session', 500)
  }

  return json(
    res,
    {
      session_token: sessionToken,
      expires_at: expiresAt,
      family: {
        id: family.id,
        name: family.name,
        slug: family.slug,
      },
    },
    201
  )
})

app.get('/api/media', async (req, res) => {
  if (!requireS3(res)) {
    return
  }

  const key = String(req.query.key || '').trim()
  if (!key) {
    return errorJson(res, 'missing_key', 'key query parameter is required', 400)
  }

  try {
    const result = await s3Client!.send(new GetObjectCommand({ Bucket: s3Bucket, Key: key }))
    const bytes = await readBodyToBuffer(result.Body)
    if (result.ContentType) {
      res.setHeader('content-type', result.ContentType)
    }
    res.setHeader('cache-control', 'public, max-age=31536000, immutable')
    res.status(200).send(bytes)
  } catch {
    errorJson(res, 'not_found', 'Media object not found', 404)
  }
})

app.post('/api/uploads/sign', (req, res) => {
  if (!enforceRateLimit(req, res, 'uploads_sign', 40, 60_000)) {
    return
  }

  const sessionResult = requireSession(req, req.body?.session_token)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  if (!getUploadEnabled()) {
    return errorJson(res, 'uploads_disabled', 'Uploads are temporarily disabled by admin', 403)
  }

  const fileName = String(req.body?.file_name || '').trim()
  const fileType = String(req.body?.file_type || '').trim()

  if (!fileName || !fileType) {
    return errorJson(res, 'missing_fields', 'file_name and file_type are required', 400)
  }

  if (!allowedUploadMimeTypes.has(fileType.toLowerCase())) {
    return errorJson(res, 'invalid_file_type', 'Only JPEG, PNG, WEBP and GIF uploads are allowed', 400)
  }

  const ext = extensionFromType(fileName, fileType)
  const storageKey = `family-${sessionResult.session.family_id}/${Date.now()}-${crypto.randomUUID()}.${ext}`
  const expiresAt = getExpiryIso(1)

  const uploadToken = signPayload({
    session_token: sessionResult.session.session_token,
    storage_key: storageKey,
    file_name: fileName,
    file_type: fileType,
    expires_at: expiresAt,
  })

  return json(res, {
    upload_url: '/api/uploads/direct',
    upload_token: uploadToken,
    storage_key: storageKey,
    expires_at: expiresAt,
  })
})

app.post('/api/uploads/direct', async (req, res) => {
  if (!requireS3(res)) {
    return
  }

  if (!enforceRateLimit(req, res, 'uploads_direct', 30, 60_000)) {
    return
  }

  const sessionResult = requireSession(req, req.body?.session_token)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  const uploadToken = String(req.body?.upload_token || '').trim()
  const mimeType = String(req.body?.mime_type || '').trim() || 'image/jpeg'
  const imageBase64 = String(req.body?.image_base64 || '').trim()

  if (!uploadToken || !imageBase64) {
    return errorJson(res, 'missing_fields', 'upload_token and image_base64 are required', 400)
  }

  if (!allowedUploadMimeTypes.has(mimeType.toLowerCase())) {
    return errorJson(res, 'invalid_mime_type', 'Only JPEG, PNG, WEBP and GIF uploads are allowed', 400)
  }

  const payload = verifySignedPayload(uploadToken)
  if (!payload) {
    return errorJson(res, 'invalid_upload_token', 'Upload token is invalid', 401)
  }

  const tokenSession = String(payload.session_token || '')
  const storageKey = String(payload.storage_key || '')
  const expiresAt = String(payload.expires_at || '')

  if (!tokenSession || !storageKey || !expiresAt) {
    return errorJson(res, 'invalid_upload_token', 'Upload token payload is incomplete', 401)
  }

  if (tokenSession !== sessionResult.session.session_token) {
    return errorJson(res, 'invalid_upload_token', 'Upload token does not belong to this session', 401)
  }

  if (new Date(expiresAt).getTime() < Date.now()) {
    return errorJson(res, 'expired_upload_token', 'Upload token has expired', 401)
  }

  let bytes: Buffer
  try {
    bytes = Buffer.from(imageBase64, 'base64')
  } catch {
    return errorJson(res, 'invalid_image', 'image_base64 is not valid base64', 400)
  }

  if (!bytes.length) {
    return errorJson(res, 'invalid_image', 'Decoded image is empty', 400)
  }

  if (bytes.length > maxUploadBytes) {
    return errorJson(res, 'file_too_large', `Decoded image exceeds ${maxUploadBytes} bytes`, 413)
  }

  try {
    await s3Client!.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: mimeType,
        CacheControl: 'public, max-age=31536000, immutable',
      })
    )
  } catch (uploadError) {
    bumpTelemetry('uploads_direct_storage_error')
    console.warn(
      `[uploads-direct] s3_upload_failed family_id=${sessionResult.session.family_id} storage_key=${storageKey} message=${
        String((uploadError as Error)?.message || 'unknown')
      }`
    )
    return errorJson(res, 'storage_error', 'Unable to store uploaded image right now', 503)
  }

  const fileUrl = `s3://${storageKey}`
  return json(res, { storage_key: storageKey, file_url: fileUrl }, 201)
})

app.post('/api/photos/register', (req, res) => {
  const sessionResult = requireSession(req, req.body?.session_token)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  const storageKey = String(req.body?.storage_key || '').trim()
  if (!storageKey) {
    return errorJson(res, 'missing_storage_key', 'storage_key is required', 400)
  }

  const explicitUrl = String(req.body?.file_url || '').trim()
  const fileUrl = explicitUrl || `s3://${storageKey}`

  const insert = db
    .prepare(
      `INSERT INTO photos (family_id, guest_session_id, original_url, filtered_url, status)
       VALUES (?, ?, ?, ?, 'pending')`
    )
    .run(sessionResult.session.family_id, sessionResult.session.id, fileUrl, fileUrl)

  return json(res, { photo_id: Number(insert.lastInsertRowid), status: 'pending' }, 201)
})

app.get('/api/gallery/approved', (req, res) => {
  const sessionResult = requireSession(req)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  const limitInput = Number(req.query.limit || 300)
  const offsetInput = Number(req.query.offset || 0)
  const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 300, 1), 500)
  const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0)

  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS total
       FROM photos
       WHERE status = 'approved' AND is_deleted = 0`
    )
    .get() as { total: number } | undefined

  const rows = db
    .prepare(
      `SELECT
         photos.id,
         photos.filtered_url,
         photos.created_at,
         families.name AS family_name,
         guest_sessions.display_name AS guest_name
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE photos.status = 'approved' AND photos.is_deleted = 0
       ORDER BY photos.created_at DESC
       LIMIT ? OFFSET ?`
    )
     .all(limit, offset) as Array<{
    id: number
    filtered_url: string | null
    created_at: string
    family_name: string
    guest_name: string | null
  }>

  const origin = `${req.protocol}://${req.get('host')}`
  const items = rows.map((row) => ({
    ...row,
    filtered_url: toPublicMediaUrl(origin, row.filtered_url),
  }))

  const total = Number(totalRow?.total || 0)
  return json(res, { items, limit, offset, total, has_more: offset + items.length < total })
})

app.post('/api/photos/:id/reaction', (req, res) => {
  const sessionResult = requireSession(req, req.body?.session_token)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  const photoId = Number(req.params.id)
  const reactionType = String(req.body?.type || 'like').trim()

  if (!Number.isFinite(photoId) || photoId <= 0) {
    return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400)
  }

  if (!['like', 'skip', 'superlike'].includes(reactionType)) {
    return errorJson(res, 'invalid_reaction', 'Unsupported reaction type', 400)
  }

  if (!ensurePhotoInFamily(photoId, sessionResult.session.family_id)) {
    return errorJson(res, 'photo_not_accessible', 'Photo not found for this family session', 404)
  }

  db.prepare('INSERT INTO reactions (photo_id, guest_session_id, reaction_type) VALUES (?, ?, ?)').run(
    photoId,
    sessionResult.session.id,
    reactionType
  )

  return json(res, { photo_id: photoId, reaction: reactionType }, 201)
})

app.get('/api/photos/:id/comments', (req, res) => {
  const sessionResult = requireSession(req)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  const photoId = Number(req.params.id)
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400)
  }

  if (!ensurePhotoInFamily(photoId, sessionResult.session.family_id)) {
    return errorJson(res, 'photo_not_accessible', 'Photo not found for this family session', 404)
  }

  const limitInput = Number(req.query.limit || 100)
  const offsetInput = Number(req.query.offset || 0)
  const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 100, 1), 200)
  const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0)

  const totalRow = db
    .prepare('SELECT COUNT(1) AS total FROM photo_comments WHERE photo_id = ?')
    .get(photoId) as { total: number } | undefined

  const rows = db
    .prepare(
      `SELECT id, display_name, body, created_at
       FROM photo_comments
       WHERE photo_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(photoId, limit, offset) as Array<{ id: number; display_name: string | null; body: string; created_at: string }>

  const total = Number(totalRow?.total || 0)
  return json(res, { photo_id: photoId, comments: rows, limit, offset, total, has_more: offset + rows.length < total })
})

app.post('/api/photos/:id/comments', (req, res) => {
  if (!enforceRateLimit(req, res, 'comments_create', 20, 60_000)) {
    return
  }

  const sessionResult = requireSession(req, req.body?.session_token)
  if (!sessionResult.ok) {
    return sessionResult.response(res)
  }

  const photoId = Number(req.params.id)
  const body = String(req.body?.body || '').trim()

  if (!Number.isFinite(photoId) || photoId <= 0) {
    return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400)
  }

  if (!body) {
    return errorJson(res, 'invalid_body', 'Comment body is required', 400)
  }

  if (body.length > 500) {
    return errorJson(res, 'too_long', 'Comment must be 500 characters or less', 400)
  }

  if (!ensurePhotoInFamily(photoId, sessionResult.session.family_id)) {
    return errorJson(res, 'photo_not_accessible', 'Photo not found for this family session', 404)
  }

  const insert = db
    .prepare('INSERT INTO photo_comments (photo_id, guest_session_id, display_name, body) VALUES (?, ?, ?, ?)')
    .run(photoId, sessionResult.session.id, sessionResult.session.display_name || null, body)

  return json(
    res,
    {
      id: Number(insert.lastInsertRowid),
      photo_id: photoId,
      display_name: sessionResult.session.display_name,
      body,
      created_at: new Date().toISOString(),
    },
    201
  )
})

app.post('/api/admin/login', (req, res) => {
  if (!enforceRateLimit(req, res, 'admin_login', 10, 10 * 60_000)) {
    return
  }

  const password = String(req.body?.password || '')
  if (password !== adminPassword) {
    return errorJson(res, 'invalid_credentials', 'Invalid admin password', 401)
  }

  return json(res, { admin_token: createAdminToken(), expires_in_hours: 8 })
})

app.post('/api/admin/families/create', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) return auth.response(res)

  const name = String(req.body?.name || '').trim().slice(0, 80)
  const slugInput = String(req.body?.slug || '').trim().toLowerCase()
  const qrInput = String(req.body?.qr_token || '').trim().toUpperCase()

  if (!name) return errorJson(res, 'missing_name', 'name is required', 400)

  const slug = (slugInput || name.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

  if (!slug) return errorJson(res, 'invalid_slug', 'slug is invalid', 400)

  const qrToken = qrInput || `FAMILY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  if (!/^[A-Z0-9_-]{6,80}$/.test(qrToken)) {
    return errorJson(res, 'invalid_qr_token', 'qr_token format is invalid', 400)
  }

  try {
    const insert = db
      .prepare('INSERT INTO families (name, slug, qr_token, is_active) VALUES (?, ?, ?, 1)')
      .run(name, slug, qrToken)
    return json(
      res,
      { family: { id: Number(insert.lastInsertRowid), name, slug, qr_token: qrToken, is_active: 1 } },
      201
    )
  } catch (e) {
    const message = String((e as Error)?.message || '')
    if (message.includes('families.slug') || message.includes('families.qr_token')) {
      return errorJson(res, 'duplicate_family', 'slug or qr_token already exists', 409)
    }
    return errorJson(res, 'db_error', 'Could not create family', 500)
  }
})

app.get('/api/admin/photos/pending', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }

  const limitInput = Number(req.query.limit || 200)
  const offsetInput = Number(req.query.offset || 0)
  const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 200, 1), 500)
  const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0)
  const search = String(req.query.search || '').trim().slice(0, 80)
  const family = String(req.query.family || '').trim().slice(0, 80)
  const familyIdInput = Number(req.query.family_id || 0)
  const familyId = Number.isFinite(familyIdInput) && familyIdInput > 0 ? familyIdInput : 0
  const fromDate = parseDateFilter(req.query.from)
  const toDate = parseDateFilter(req.query.to)

  const whereParts = ["photos.status = 'pending'", 'photos.is_deleted = 0']
  const whereArgs: Array<string> = []

  if (search) {
    const searchLike = `%${escapeSqlLike(search)}%`
    whereParts.push("(COALESCE(guest_sessions.display_name, '') LIKE ? ESCAPE '\\' OR families.name LIKE ? ESCAPE '\\')")
    whereArgs.push(searchLike, searchLike)
  }
  if (family) {
    whereParts.push("families.name LIKE ? ESCAPE '\\'")
    whereArgs.push(`%${escapeSqlLike(family)}%`)
  }
  if (familyId) {
    whereParts.push('photos.family_id = ?')
    whereArgs.push(String(familyId))
  }
  if (fromDate) {
    whereParts.push('date(photos.created_at) >= date(?)')
    whereArgs.push(fromDate)
  }
  if (toDate) {
    whereParts.push('date(photos.created_at) <= date(?)')
    whereArgs.push(toDate)
  }

  const whereClause = whereParts.join(' AND ')

  const rows = db
    .prepare(
      `SELECT
         photos.id,
         photos.original_url,
         photos.filtered_url,
         photos.created_at,
         families.name AS family_name,
         guest_sessions.display_name AS guest_name
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}
       ORDER BY photos.created_at DESC
       LIMIT ? OFFSET ?`
    )
     .all(...whereArgs, limit, offset) as Array<{
    id: number
    original_url: string | null
    filtered_url: string | null
    created_at: string
    family_name: string
    guest_name: string | null
  }>

  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS total
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}`
    )
    .get(...whereArgs) as { total: number } | undefined

  const origin = `${req.protocol}://${req.get('host')}`
  const items = rows.map((row) => ({
    ...row,
    original_url: toPublicMediaUrl(origin, row.original_url),
    filtered_url: toPublicMediaUrl(origin, row.filtered_url),
  }))

  const total = Number(totalRow?.total || 0)
  return json(res, { items, limit, offset, total, has_more: offset + items.length < total })
})

app.post('/api/admin/photos/bulk-approve', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) {
    return auth.response(res)
  }

  const ids = String(req.body?.ids_csv || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0)

  if (!ids.length) {
    return errorJson(res, 'invalid_ids', 'ids_csv is required', 400)
  }

  const tx = db.transaction((items: number[]) => {
    const approveStmt = db.prepare("UPDATE photos SET status = 'approved' WHERE id = ? AND is_deleted = 0")
    const actionStmt = db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'approve', 'admin')")
    for (const id of items) {
      approveStmt.run(id)
      actionStmt.run(id)
    }
  })

  tx(ids)

  return json(res, { updated: ids.length })
})

app.post('/api/admin/photos/bulk-reject', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) {
    return auth.response(res)
  }

  const ids = String(req.body?.ids_csv || '')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0)

  if (!ids.length) {
    return errorJson(res, 'invalid_ids', 'ids_csv is required', 400)
  }

  const tx = db.transaction((items: number[]) => {
    const rejectStmt = db.prepare("UPDATE photos SET status = 'rejected' WHERE id = ? AND is_deleted = 0")
    const actionStmt = db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'reject', 'admin')")
    for (const id of items) {
      rejectStmt.run(id)
      actionStmt.run(id)
    }
  })

  tx(ids)

  return json(res, { updated: ids.length })
})

app.get('/api/admin/photos/approved', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }

  const limitInput = Number(req.query.limit || 200)
  const offsetInput = Number(req.query.offset || 0)
  const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 200, 1), 500)
  const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0)
  const search = String(req.query.search || '').trim().slice(0, 80)
  const family = String(req.query.family || '').trim().slice(0, 80)
  const familyIdInput = Number(req.query.family_id || 0)
  const familyId = Number.isFinite(familyIdInput) && familyIdInput > 0 ? familyIdInput : 0
  const fromDate = parseDateFilter(req.query.from)
  const toDate = parseDateFilter(req.query.to)

  const whereParts = ["photos.status = 'approved'", 'photos.is_deleted = 0']
  const whereArgs: Array<string> = []

  if (search) {
    const searchLike = `%${escapeSqlLike(search)}%`
    whereParts.push("(COALESCE(guest_sessions.display_name, '') LIKE ? ESCAPE '\\' OR families.name LIKE ? ESCAPE '\\')")
    whereArgs.push(searchLike, searchLike)
  }
  if (family) {
    whereParts.push("families.name LIKE ? ESCAPE '\\'")
    whereArgs.push(`%${escapeSqlLike(family)}%`)
  }
  if (familyId) {
    whereParts.push('photos.family_id = ?')
    whereArgs.push(String(familyId))
  }
  if (fromDate) {
    whereParts.push('date(photos.created_at) >= date(?)')
    whereArgs.push(fromDate)
  }
  if (toDate) {
    whereParts.push('date(photos.created_at) <= date(?)')
    whereArgs.push(toDate)
  }

  const whereClause = whereParts.join(' AND ')

  const rows = db
    .prepare(
      `SELECT
         photos.id,
         photos.original_url,
         photos.filtered_url,
         photos.created_at,
         families.name AS family_name,
         guest_sessions.display_name AS guest_name
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}
       ORDER BY photos.created_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(...whereArgs, limit, offset) as Array<{
    id: number
    original_url: string | null
    filtered_url: string | null
    created_at: string
    family_name: string
    guest_name: string | null
  }>

  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS total
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}`
    )
    .get(...whereArgs) as { total: number } | undefined

  const origin = `${req.protocol}://${req.get('host')}`
  const items = rows.map((row) => ({
    ...row,
    original_url: toPublicMediaUrl(origin, row.original_url),
    filtered_url: toPublicMediaUrl(origin, row.filtered_url),
  }))

  const total = Number(totalRow?.total || 0)
  return json(res, { items, limit, offset, total, has_more: offset + items.length < total })
})

app.post('/api/admin/photos/:id/delete', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) {
    return auth.response(res)
  }

  const photoId = Number(req.params.id)
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400)
  }

  const update = db.prepare('UPDATE photos SET is_deleted = 1 WHERE id = ?').run(photoId)
  if (!update.changes) {
    return errorJson(res, 'not_found', 'Photo not found', 404)
  }

  db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'delete', 'admin')").run(photoId)

  return json(res, { photo_id: photoId, deleted: true })
})

app.post('/api/admin/photos/:id/approve', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) {
    return auth.response(res)
  }

  const photoId = Number(req.params.id)
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400)
  }

  db.prepare("UPDATE photos SET status = 'approved' WHERE id = ?").run(photoId)
  db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'approve', 'admin')").run(photoId)

  return json(res, { photo_id: photoId, status: 'approved' })
})

app.post('/api/admin/photos/:id/reject', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) {
    return auth.response(res)
  }

  const photoId = Number(req.params.id)
  if (!Number.isFinite(photoId) || photoId <= 0) {
    return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400)
  }

  db.prepare("UPDATE photos SET status = 'rejected' WHERE id = ?").run(photoId)
  db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'reject', 'admin')").run(photoId)

  return json(res, { photo_id: photoId, status: 'rejected' })
})

app.get('/api/admin/upload-toggle', (req, res) => {
  const auth = requireAdmin(req)
  if (!auth.ok) {
    return auth.response(res)
  }

  return json(res, { upload_enabled: getUploadEnabled() })
})

app.post('/api/admin/upload-toggle', (req, res) => {
  const auth = requireAdmin(req, req.body?.admin_token)
  if (!auth.ok) {
    return auth.response(res)
  }

  const enabled = req.body?.enabled === '1' || req.body?.enabled === 'true' || req.body?.enabled === true

  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES ('upload_enabled', ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(enabled ? '1' : '0')

  return json(res, { upload_enabled: enabled })
})

app.post('/api/dev/seed-approved', async (req, res) => {
  if (!requireS3(res)) {
    return
  }

  const qrToken = String(req.body?.qr_token || 'BALODHI-QR-2026').trim()
  const family = findFamilyByToken(qrToken)
  if (!family) {
    return errorJson(res, 'invalid_token', 'Family token not found for seeding', 400)
  }

  const sessionToken = generateToken()
  const expiresAt = getExpiryIso(24)
  const insertSession = db
    .prepare('INSERT INTO guest_sessions (family_id, display_name, session_token, expires_at) VALUES (?, ?, ?, ?)')
    .run(family.id, 'Demo Seeder', sessionToken, expiresAt)

  const key = `family-${family.id}/demo-${Date.now()}-${crypto.randomUUID()}.gif`
  const demoGif = Buffer.from('R0lGODlhAQABAIAAAAUEBA==', 'base64')

  await s3Client!.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: demoGif,
      ContentType: 'image/gif',
      CacheControl: 'public, max-age=31536000, immutable',
    })
  )

  const fileUrl = `s3://${key}`
  const insertPhoto = db
    .prepare(
      "INSERT INTO photos (family_id, guest_session_id, original_url, filtered_url, status) VALUES (?, ?, ?, ?, 'approved')"
    )
    .run(family.id, Number(insertSession.lastInsertRowid), fileUrl, fileUrl)

  const origin = `${req.protocol}://${req.get('host')}`

  return json(res, {
    seeded: true,
    family: family.name,
    photo_id: Number(insertPhoto.lastInsertRowid),
    media_url: toPublicMediaUrl(origin, fileUrl),
  })
})

app.use((_req, res) => {
  errorJson(res, 'not_found', 'Route not found', 404)
})

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`)
  console.log(`SQLite DB path: ${dbPath}`)
  if (!renderDiskPath) {
    console.warn('RENDER_DISK_PATH is not set. SQLite may be ephemeral on redeploy in production.')
  }
  if (!s3Bucket) {
    console.log('S3 not configured: set S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY')
  }
})
