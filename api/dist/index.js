import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { createAuth } from './auth';
import { config } from './config';
import * as dbMod from './db';
import { createStorageClient } from './storage';
import { extensionFromType, toPublicMediaUrl, validateUpload } from './storage/validation';
const rateLimitStore = new Map();
const telemetryCounters = new Map();
const bumpTelemetry = (key) => {
    const normalized = String(key || '').trim().slice(0, 120);
    if (!normalized) {
        return;
    }
    telemetryCounters.set(normalized, Number(telemetryCounters.get(normalized) || 0) + 1);
};
const normalizeTelemetryPath = (pathValue) => {
    return String(pathValue || '')
        .replace(/\/[0-9]+(?=\/|$)/g, '/:id')
        .replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/:id');
};
const db = dbMod.createDatabase();
dbMod.applyMigrations(db);
dbMod.seedDefaultFamilies(db);
const auth = createAuth({ db, signingSecret: config.signingSecret });
const getStorageClient = (origin) => createStorageClient(config.storage, origin);
const app = express();
app.use(cors({
    origin: (origin, callback) => {
        // Allow non-browser/server-to-server requests with no Origin header.
        if (!origin) {
            return callback(null, true);
        }
        if (config.allowedProdOrigins.has(origin)) {
            return callback(null, true);
        }
        if (config.isDevelopment && config.devOriginRegex.test(origin)) {
            return callback(null, true);
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['content-type', 'authorization', 'x-session-token', 'x-admin-token'],
}));
app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
        if (!req.path.startsWith('/api/')) {
            return;
        }
        const normalizedPath = normalizeTelemetryPath(req.path);
        const routeKey = `${req.method.toLowerCase()}_${normalizedPath}`;
        const durationMs = Date.now() - startedAt;
        bumpTelemetry(`api_route_${routeKey}`);
        let latencyBucket = 'fast';
        if (durationMs >= 2000) {
            latencyBucket = 'over_2000ms';
        }
        else if (durationMs >= 1000) {
            latencyBucket = '1000_to_1999ms';
        }
        else if (durationMs >= 500) {
            latencyBucket = '500_to_999ms';
        }
        else if (durationMs >= 200) {
            latencyBucket = '200_to_499ms';
        }
        bumpTelemetry(`api_latency_${latencyBucket}_${routeKey}`);
        if (durationMs >= config.slowRequestWarnMs) {
            bumpTelemetry('api_slow_request');
            console.warn(`[api-latency] ${req.method} ${req.originalUrl} status=${res.statusCode} duration_ms=${durationMs} ip=${req.ip || 'unknown'}`);
        }
    });
    next();
});
const json = (res, data, status = 200) => {
    res.status(status).json(data);
};
const errorJson = (res, error, message, status) => {
    json(res, { error, message }, status);
};
const parseDateFilter = (value) => {
    const trimmed = String(value || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : '';
};
const generateToken = () => {
    return `sess_${crypto.randomUUID().replace(/-/g, '')}`;
};
const getExpiryIso = (hours) => {
    return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
};
// Auth, token signing, and verification are handled by src/auth.ts via `auth`
const getRequestIp = (req) => {
    const xff = String(req.headers['x-forwarded-for'] || '').trim();
    if (xff) {
        return xff.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
};
const enforceRateLimit = (req, res, key, maxRequests, windowMs) => {
    const now = Date.now();
    const bucketKey = `${key}:${getRequestIp(req)}`;
    const current = rateLimitStore.get(bucketKey);
    if (!current || now >= current.resetAt) {
        rateLimitStore.set(bucketKey, { count: 1, resetAt: now + windowMs });
        return true;
    }
    if (current.count >= maxRequests) {
        const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.setHeader('retry-after', String(retryAfter));
        errorJson(res, 'rate_limited', `Too many requests. Retry in ${retryAfter} seconds.`, 429);
        return false;
    }
    current.count += 1;
    return true;
};
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
            'POST /api/admin/families/reseed-defaults',
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
    });
});
app.get('/api/health', (_req, res) => {
    json(res, { status: 'ok', service: 'wedding-photo-api' });
});
app.post('/api/telemetry/client', (req, res) => {
    if (!enforceRateLimit(req, res, 'client_telemetry', 80, 60_000)) {
        return;
    }
    const eventName = String(req.body?.event || '').trim().slice(0, 80);
    if (!eventName) {
        return errorJson(res, 'missing_event', 'event is required', 400);
    }
    const detailsRaw = req.body?.details;
    let details = {};
    if (detailsRaw && typeof detailsRaw === 'object' && !Array.isArray(detailsRaw)) {
        details = detailsRaw;
    }
    console.warn(`[client-telemetry] event=${eventName} ip=${req.ip || 'unknown'} details=${JSON.stringify(details).slice(0, 1200)}`);
    bumpTelemetry(`client_${eventName}`);
    return json(res, { ok: true });
});
app.get('/api/admin/telemetry/summary', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const allCounters = Array.from(telemetryCounters.entries())
        .map(([event, count]) => ({ event, count }))
        .sort((a, b) => b.count - a.count);
    const counters = allCounters.slice(0, 50);
    const routeHits = allCounters.filter((item) => item.event.startsWith('api_route_')).slice(0, 30);
    const latencyBuckets = allCounters.filter((item) => item.event.startsWith('api_latency_')).slice(0, 30);
    const clientEvents = allCounters.filter((item) => item.event.startsWith('client_')).slice(0, 30);
    const other = allCounters
        .filter((item) => !item.event.startsWith('api_route_') && !item.event.startsWith('api_latency_') && !item.event.startsWith('client_'))
        .slice(0, 30);
    const sumCounts = (items) => items.reduce((acc, item) => acc + Number(item.count || 0), 0);
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
    });
});
app.post('/api/admin/telemetry/reset', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const countBefore = telemetryCounters.size;
    telemetryCounters.clear();
    console.warn(`[telemetry-reset] cleared ${countBefore} counters ip=${req.ip || 'unknown'}`);
    return json(res, { ok: true, cleared: countBefore });
});
app.get('/api/admin/families', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const rows = dbMod.getAllFamilies(db);
    return json(res, { families: rows.map((family) => ({ ...family })) });
});
app.get('/api/admin/health-snapshot', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    let dbFileSizeBytes = 0;
    try {
        dbFileSizeBytes = fs.existsSync(dbMod.getDatabasePath()) ? fs.statSync(dbMod.getDatabasePath()).size : 0;
    }
    catch {
        dbFileSizeBytes = 0;
    }
    const pendingCount = dbMod.countPhotosByStatus(db, 'pending');
    const approvedCount = dbMod.countPhotosByStatus(db, 'approved');
    const familyCount = dbMod.countFamilies(db);
    const activeSessionCount = dbMod.countActiveSessions(db);
    const telemetryEventCount = Array.from(telemetryCounters.values()).reduce((sum, count) => sum + Number(count || 0), 0);
    return json(res, {
        now: new Date().toISOString(),
        status: {
            db_ok: true,
            s3_configured: Boolean(config.storage.bucket),
            upload_enabled: dbMod.getUploadEnabled(db),
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
    });
});
app.post('/api/token/validate', (req, res) => {
    const qrToken = String(req.body?.qr_token || '').trim();
    if (!qrToken) {
        return errorJson(res, 'missing_token', 'qr_token is required', 400);
    }
    const family = dbMod.findFamilyByToken(db, qrToken);
    if (!family) {
        return errorJson(res, 'invalid_token', 'QR token not found or inactive', 404);
    }
    return json(res, { family: { ...family } }, 201);
});
app.post('/api/session/start', (req, res) => {
    const qrToken = String(req.body?.qr_token || '').trim();
    const guestNameRaw = String(req.body?.guest_name || '').trim();
    const guestName = guestNameRaw.slice(0, 60);
    if (!qrToken) {
        return errorJson(res, 'missing_token', 'qr_token is required', 400);
    }
    const family = dbMod.findFamilyByToken(db, qrToken);
    if (!family) {
        return errorJson(res, 'invalid_token', 'QR token not found or inactive', 404);
    }
    const sessionToken = generateToken();
    const expiresAt = getExpiryIso(24);
    const session = dbMod.createGuestSession(db, family.id, guestName || null, sessionToken, expiresAt);
    if (!session?.id) {
        return errorJson(res, 'db_error', 'Could not create guest session', 500);
    }
    // Get photo limit from family (new disposable camera feature)
    const photoLimit = typeof family.photo_limit_per_guest === 'number' ? family.photo_limit_per_guest : 25;
    const takenCount = dbMod.countPhotosBySession(db, session.id);
    const shotsRemaining = Math.max(0, photoLimit - takenCount);
    return json(res, {
        session_token: sessionToken,
        expires_at: expiresAt,
        family: {
            id: family.id,
            name: family.name,
            slug: family.slug,
        },
        photo_limit: photoLimit,
        shots_remaining: shotsRemaining,
        total_shots_taken: takenCount,
    }, 201);
});
app.get('/api/media', async (req, res) => {
    const key = String(req.query.key || '').trim();
    if (!key) {
        return errorJson(res, 'missing_key', 'key query parameter is required', 400);
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const storageClient = getStorageClient(origin);
    if (!storageClient) {
        return errorJson(res, 'storage_unavailable', 'S3 is not configured. Set S3_BUCKET and AWS credentials.', 503);
    }
    const result = await storageClient.getFile(key);
    if (!result.success || !result.data) {
        return errorJson(res, 'not_found', 'Media object not found', 404);
    }
    if (result.contentType) {
        res.setHeader('content-type', result.contentType);
    }
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.status(200).send(result.data);
});
app.post('/api/uploads/sign', (req, res) => {
    if (!enforceRateLimit(req, res, 'uploads_sign', 40, 60_000)) {
        return;
    }
    const sessionResult = auth.requireSession(req, req.body?.session_token);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    if (!dbMod.getUploadEnabled(db)) {
        return errorJson(res, 'uploads_disabled', 'Uploads are temporarily disabled by admin', 403);
    }
    const fileName = String(req.body?.file_name || '').trim();
    const fileType = String(req.body?.file_type || '').trim();
    const validation = validateUpload(fileName, fileType, 0);
    if (!validation.valid) {
        return errorJson(res, 'invalid_file_type', validation.error || 'Invalid upload metadata', 400);
    }
    const ext = extensionFromType(fileName, fileType);
    const storageKey = `family-${sessionResult.session.family_id}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const expiresAt = getExpiryIso(1);
    const uploadToken = auth.signPayload({
        session_token: sessionResult.session.session_token,
        storage_key: storageKey,
        file_name: fileName,
        file_type: fileType,
        expires_at: expiresAt,
    });
    return json(res, {
        upload_url: '/api/uploads/direct',
        upload_token: uploadToken,
        storage_key: storageKey,
        expires_at: expiresAt,
    });
});
app.post('/api/uploads/direct', async (req, res) => {
    if (!enforceRateLimit(req, res, 'uploads_direct', 30, 60_000)) {
        return;
    }
    const sessionResult = auth.requireSession(req, req.body?.session_token);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const uploadToken = String(req.body?.upload_token || '').trim();
    const mimeType = String(req.body?.mime_type || '').trim() || 'image/jpeg';
    const imageBase64 = String(req.body?.image_base64 || '').trim();
    if (!uploadToken || !imageBase64) {
        return errorJson(res, 'missing_fields', 'upload_token and image_base64 are required', 400);
    }
    const payload = auth.verifySignedPayload(uploadToken);
    if (!payload) {
        return errorJson(res, 'invalid_upload_token', 'Upload token is invalid', 401);
    }
    const tokenSession = String(payload.session_token || '');
    const storageKey = String(payload.storage_key || '');
    const expiresAt = String(payload.expires_at || '');
    if (!tokenSession || !storageKey || !expiresAt) {
        return errorJson(res, 'invalid_upload_token', 'Upload token payload is incomplete', 401);
    }
    if (tokenSession !== sessionResult.session.session_token) {
        return errorJson(res, 'invalid_upload_token', 'Upload token does not belong to this session', 401);
    }
    if (new Date(expiresAt).getTime() < Date.now()) {
        return errorJson(res, 'expired_upload_token', 'Upload token has expired', 401);
    }
    let bytes;
    try {
        bytes = Buffer.from(imageBase64, 'base64');
    }
    catch {
        return errorJson(res, 'invalid_image', 'image_base64 is not valid base64', 400);
    }
    if (!bytes.length) {
        return errorJson(res, 'invalid_image', 'Decoded image is empty', 400);
    }
    const validation = validateUpload(String(payload.file_name || ''), mimeType, bytes.length);
    if (!validation.valid) {
        return errorJson(res, 'invalid_image', validation.error || 'Upload validation failed', 400);
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const storageClient = getStorageClient(origin);
    if (!storageClient) {
        return errorJson(res, 'storage_unavailable', 'S3 is not configured. Set S3_BUCKET and AWS credentials.', 503);
    }
    const uploadResult = await storageClient.uploadFile(storageKey, bytes, {
        contentType: mimeType,
        cacheControl: 'public, max-age=31536000, immutable',
    });
    if (!uploadResult.success) {
        bumpTelemetry('uploads_direct_storage_error');
        console.warn(`[uploads-direct] s3_upload_failed family_id=${sessionResult.session.family_id} storage_key=${storageKey} message=${uploadResult.error || 'unknown'}`);
        return errorJson(res, 'storage_error', 'Unable to store uploaded image right now', 503);
    }
    const fileUrl = `s3://${storageKey}`;
    return json(res, { storage_key: storageKey, file_url: fileUrl }, 201);
});
// NEW: Camera capture endpoint for disposable camera feature
app.post('/api/camera/capture', async (req, res) => {
    if (!enforceRateLimit(req, res, 'camera_capture', 10, 60_000)) {
        return;
    }
    const sessionResult = auth.requireSession(req, req.body?.session_token);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const imageBase64 = String(req.body?.image_base64 || '').trim();
    const cameraFacing = String(req.body?.camera_facing || 'environment').trim();
    if (!imageBase64) {
        return errorJson(res, 'missing_image', 'image_base64 is required', 400);
    }
    // Validate base64 image format
    if (!imageBase64.startsWith('data:image/')) {
        return errorJson(res, 'invalid_image', 'Image must be a data URL', 400);
    }
    // Check photo limit
    const family = dbMod.findFamilyByToken(db, String(req.body?.qr_token || ''));
    const photoLimit = family?.photo_limit_per_guest || 25;
    const takenCount = dbMod.countPhotosBySession(db, sessionResult.session.id);
    const shotsRemaining = photoLimit - takenCount;
    if (shotsRemaining <= 0) {
        return errorJson(res, 'no_shots_remaining', 'Guest has used all photo credits', 403);
    }
    // Decode base64 to buffer
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    let bytes;
    try {
        bytes = Buffer.from(base64Data, 'base64');
    }
    catch {
        return errorJson(res, 'invalid_image', 'Invalid base64 encoding', 400);
    }
    if (!bytes.length) {
        return errorJson(res, 'invalid_image', 'Decoded image is empty', 400);
    }
    if (bytes.length > config.maxUploadBytes) {
        return errorJson(res, 'image_too_large', `Image exceeds ${config.maxUploadBytes / 1024 / 1024}MB limit`, 413);
    }
    const origin = `${req.protocol}://${req.get('host')}`;
    const storageClient = getStorageClient(origin);
    if (!storageClient) {
        return errorJson(res, 'storage_unavailable', 'S3 is not configured', 503);
    }
    // Upload to S3
    const storageKey = `family-${sessionResult.session.family_id}/${Date.now()}-${sessionResult.session.session_token.slice(0, 8)}.jpg`;
    const uploadResult = await storageClient.uploadFile(storageKey, bytes, {
        contentType: 'image/jpeg',
        cacheControl: 'public, max-age=31536000, immutable',
    });
    if (!uploadResult.success) {
        bumpTelemetry('camera_capture_storage_error');
        console.warn(`[camera-capture] s3_upload_failed family_id=${sessionResult.session.family_id} session_id=${sessionResult.session.id}`);
        return errorJson(res, 'storage_error', 'Unable to save photo right now', 503);
    }
    // Register photo as pending
    const fileUrl = `s3://${storageKey}`;
    const photo = dbMod.createPhoto(db, sessionResult.session.family_id, sessionResult.session.id, fileUrl, fileUrl, 'pending');
    bumpTelemetry('camera_capture_success');
    return json(res, {
        success: true,
        photo_id: photo.id,
        storage_key: storageKey,
        shots_remaining: Math.max(0, photoLimit - takenCount - 1),
        status: 'pending',
    }, 201);
});
app.post('/api/photos/register', (req, res) => {
    const sessionResult = auth.requireSession(req, req.body?.session_token);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const storageKey = String(req.body?.storage_key || '').trim();
    if (!storageKey) {
        return errorJson(res, 'missing_storage_key', 'storage_key is required', 400);
    }
    const explicitUrl = String(req.body?.file_url || '').trim();
    const fileUrl = explicitUrl || `s3://${storageKey}`;
    const photo = dbMod.createPhoto(db, sessionResult.session.family_id, sessionResult.session.id, fileUrl, fileUrl, 'pending');
    return json(res, { photo_id: photo.id, status: 'pending' }, 201);
});
app.get('/api/gallery/approved', (req, res) => {
    const sessionResult = auth.requireSession(req);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const limitInput = Number(req.query.limit || 300);
    const offsetInput = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 300, 1), 500);
    const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0);
    const result = dbMod.getApprovedPhotos(db, limit, offset);
    const origin = `${req.protocol}://${req.get('host')}`;
    return json(res, {
        ...result,
        items: result.items.map((row) => ({
            ...row,
            filtered_url: toPublicMediaUrl(origin, row.filtered_url),
        })),
    });
});
app.post('/api/photos/:id/reaction', (req, res) => {
    const sessionResult = auth.requireSession(req, req.body?.session_token);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const photoId = Number(req.params.id);
    const reactionType = String(req.body?.type || 'like').trim();
    if (!Number.isFinite(photoId) || photoId <= 0) {
        return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400);
    }
    if (!['like', 'skip', 'superlike'].includes(reactionType)) {
        return errorJson(res, 'invalid_reaction', 'Unsupported reaction type', 400);
    }
    if (!dbMod.ensurePhotoInFamily(db, photoId, sessionResult.session.family_id)) {
        return errorJson(res, 'photo_not_accessible', 'Photo not found for this family session', 404);
    }
    dbMod.createReaction(db, photoId, sessionResult.session.id, reactionType);
    return json(res, { photo_id: photoId, reaction: reactionType }, 201);
});
app.get('/api/photos/:id/comments', (req, res) => {
    const sessionResult = auth.requireSession(req);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const photoId = Number(req.params.id);
    if (!Number.isFinite(photoId) || photoId <= 0) {
        return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400);
    }
    if (!dbMod.ensurePhotoInFamily(db, photoId, sessionResult.session.family_id)) {
        return errorJson(res, 'photo_not_accessible', 'Photo not found for this family session', 404);
    }
    const limitInput = Number(req.query.limit || 100);
    const offsetInput = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 100, 1), 200);
    const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0);
    const result = dbMod.getCommentsByPhotoId(db, photoId, limit, offset);
    return json(res, {
        photo_id: photoId,
        comments: result.items.map((comment) => ({ ...comment })),
        limit: result.limit,
        offset: result.offset,
        total: result.total,
        has_more: result.has_more,
    });
});
app.post('/api/photos/:id/comments', (req, res) => {
    if (!enforceRateLimit(req, res, 'comments_create', 20, 60_000)) {
        return;
    }
    const sessionResult = auth.requireSession(req, req.body?.session_token);
    if (!sessionResult.ok) {
        return sessionResult.response(res);
    }
    const photoId = Number(req.params.id);
    const body = String(req.body?.body || '').trim();
    if (!Number.isFinite(photoId) || photoId <= 0) {
        return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400);
    }
    if (!body) {
        return errorJson(res, 'invalid_body', 'Comment body is required', 400);
    }
    if (body.length > 500) {
        return errorJson(res, 'too_long', 'Comment must be 500 characters or less', 400);
    }
    if (!dbMod.ensurePhotoInFamily(db, photoId, sessionResult.session.family_id)) {
        return errorJson(res, 'photo_not_accessible', 'Photo not found for this family session', 404);
    }
    const comment = dbMod.createComment(db, photoId, sessionResult.session.id, sessionResult.session.display_name || null, body);
    return json(res, {
        ...comment,
    }, 201);
});
app.post('/api/admin/login', (req, res) => {
    if (!enforceRateLimit(req, res, 'admin_login', 10, 10 * 60_000)) {
        return;
    }
    const password = String(req.body?.password || '');
    if (password !== config.adminPassword) {
        return errorJson(res, 'invalid_credentials', 'Invalid admin password', 401);
    }
    return json(res, { admin_token: auth.createAdminToken(), expires_in_hours: 8 });
});
app.post('/api/admin/families/reseed-defaults', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const before = dbMod.countFamilies(db);
    dbMod.seedDefaultFamilies(db);
    const after = dbMod.countFamilies(db);
    return json(res, {
        ok: true,
        seeded_from_migration: '0002_seed_families.sql',
        families_before: before,
        families_after: after,
        inserted: Math.max(0, after - before),
    });
});
app.post('/api/admin/families/create', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok)
        return adminAuth.response(res);
    const name = String(req.body?.name || '').trim().slice(0, 80);
    const slugInput = String(req.body?.slug || '').trim().toLowerCase();
    const qrInput = String(req.body?.qr_token || '').trim().toUpperCase();
    if (!name)
        return errorJson(res, 'missing_name', 'name is required', 400);
    const slug = (slugInput || name.toLowerCase())
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    if (!slug)
        return errorJson(res, 'invalid_slug', 'slug is invalid', 400);
    const qrToken = qrInput || `FAMILY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    if (!/^[A-Z0-9_-]{6,80}$/.test(qrToken)) {
        return errorJson(res, 'invalid_qr_token', 'qr_token format is invalid', 400);
    }
    try {
        const family = dbMod.createFamily(db, name, slug, qrToken);
        return json(res, { family: { ...family } }, 201);
    }
    catch (e) {
        const message = String(e?.message || '');
        if (message.includes('families.slug') || message.includes('families.qr_token')) {
            return errorJson(res, 'duplicate_family', 'slug or qr_token already exists', 409);
        }
        return errorJson(res, 'db_error', 'Could not create family', 500);
    }
});
app.get('/api/admin/photos/pending', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const limitInput = Number(req.query.limit || 200);
    const offsetInput = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 200, 1), 500);
    const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0);
    const search = String(req.query.search || '').trim().slice(0, 80);
    const family = String(req.query.family || '').trim().slice(0, 80);
    const familyIdInput = Number(req.query.family_id || 0);
    const familyId = Number.isFinite(familyIdInput) && familyIdInput > 0 ? familyIdInput : 0;
    const fromDate = parseDateFilter(req.query.from);
    const toDate = parseDateFilter(req.query.to);
    const result = dbMod.getPhotosByStatus(db, 'pending', {
        search,
        family,
        family_id: familyId || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        limit,
        offset,
    });
    const origin = `${req.protocol}://${req.get('host')}`;
    return json(res, {
        ...result,
        items: result.items.map((row) => ({
            ...row,
            original_url: toPublicMediaUrl(origin, row.original_url),
            filtered_url: toPublicMediaUrl(origin, row.filtered_url),
        })),
    });
});
app.post('/api/admin/photos/bulk-approve', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const ids = String(req.body?.ids_csv || '')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0);
    if (!ids.length) {
        return errorJson(res, 'invalid_ids', 'ids_csv is required', 400);
    }
    const updated = dbMod.bulkApprovePhotos(db, ids);
    return json(res, { updated });
});
app.post('/api/admin/photos/bulk-reject', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const ids = String(req.body?.ids_csv || '')
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isFinite(x) && x > 0);
    if (!ids.length) {
        return errorJson(res, 'invalid_ids', 'ids_csv is required', 400);
    }
    const updated = dbMod.bulkRejectPhotos(db, ids);
    return json(res, { updated });
});
app.get('/api/admin/photos/approved', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const limitInput = Number(req.query.limit || 200);
    const offsetInput = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(limitInput) ? limitInput : 200, 1), 500);
    const offset = Math.max(Number.isFinite(offsetInput) ? offsetInput : 0, 0);
    const search = String(req.query.search || '').trim().slice(0, 80);
    const family = String(req.query.family || '').trim().slice(0, 80);
    const familyIdInput = Number(req.query.family_id || 0);
    const familyId = Number.isFinite(familyIdInput) && familyIdInput > 0 ? familyIdInput : 0;
    const fromDate = parseDateFilter(req.query.from);
    const toDate = parseDateFilter(req.query.to);
    const result = dbMod.getPhotosByStatus(db, 'approved', {
        search,
        family,
        family_id: familyId || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        limit,
        offset,
    });
    const origin = `${req.protocol}://${req.get('host')}`;
    return json(res, {
        ...result,
        items: result.items.map((row) => ({
            ...row,
            original_url: toPublicMediaUrl(origin, row.original_url),
            filtered_url: toPublicMediaUrl(origin, row.filtered_url),
        })),
    });
});
app.post('/api/admin/photos/:id/delete', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const photoId = Number(req.params.id);
    if (!Number.isFinite(photoId) || photoId <= 0) {
        return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400);
    }
    if (!dbMod.softDeletePhoto(db, photoId)) {
        return errorJson(res, 'not_found', 'Photo not found', 404);
    }
    dbMod.createModerationAction(db, photoId, 'delete', 'admin');
    return json(res, { photo_id: photoId, deleted: true });
});
app.post('/api/admin/photos/:id/approve', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const photoId = Number(req.params.id);
    if (!Number.isFinite(photoId) || photoId <= 0) {
        return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400);
    }
    dbMod.updatePhotoStatus(db, photoId, 'approved');
    dbMod.createModerationAction(db, photoId, 'approve', 'admin');
    return json(res, { photo_id: photoId, status: 'approved' });
});
app.post('/api/admin/photos/:id/reject', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const photoId = Number(req.params.id);
    if (!Number.isFinite(photoId) || photoId <= 0) {
        return errorJson(res, 'invalid_photo_id', 'Invalid photo id', 400);
    }
    dbMod.updatePhotoStatus(db, photoId, 'rejected');
    dbMod.createModerationAction(db, photoId, 'reject', 'admin');
    return json(res, { photo_id: photoId, status: 'rejected' });
});
app.get('/api/admin/upload-toggle', (req, res) => {
    const adminAuth = auth.requireAdmin(req);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    return json(res, { upload_enabled: dbMod.getUploadEnabled(db) });
});
app.post('/api/admin/upload-toggle', (req, res) => {
    const adminAuth = auth.requireAdmin(req, req.body?.admin_token);
    if (!adminAuth.ok) {
        return adminAuth.response(res);
    }
    const enabled = req.body?.enabled === '1' || req.body?.enabled === 'true' || req.body?.enabled === true;
    dbMod.setUploadEnabled(db, enabled);
    return json(res, { upload_enabled: enabled });
});
app.post('/api/dev/seed-approved', async (req, res) => {
    const qrToken = String(req.body?.qr_token || 'BALODHI-QR-2026').trim();
    const family = dbMod.findFamilyByToken(db, qrToken);
    if (!family) {
        return errorJson(res, 'invalid_token', 'Family token not found for seeding', 400);
    }
    const sessionToken = generateToken();
    const expiresAt = getExpiryIso(24);
    const insertSession = dbMod.createGuestSession(db, family.id, 'Demo Seeder', sessionToken, expiresAt);
    const key = `family-${family.id}/demo-${Date.now()}-${crypto.randomUUID()}.gif`;
    const demoGif = Buffer.from('R0lGODlhAQABAIAAAAUEBA==', 'base64');
    const origin = `${req.protocol}://${req.get('host')}`;
    const storageClient = getStorageClient(origin);
    if (!storageClient) {
        return errorJson(res, 'storage_unavailable', 'S3 is not configured. Set S3_BUCKET and AWS credentials.', 503);
    }
    const uploadResult = await storageClient.uploadFile(key, demoGif, {
        contentType: 'image/gif',
        cacheControl: 'public, max-age=31536000, immutable',
    });
    if (!uploadResult.success) {
        return errorJson(res, 'storage_error', 'Unable to store seeded image right now', 503);
    }
    const fileUrl = `s3://${key}`;
    const photo = dbMod.createPhoto(db, family.id, insertSession.id, fileUrl, fileUrl, 'approved');
    return json(res, {
        seeded: true,
        family: family.name,
        photo_id: photo.id,
        media_url: toPublicMediaUrl(origin, fileUrl),
    });
});
app.use((_req, res) => {
    errorJson(res, 'not_found', 'Route not found', 404);
});
app.listen(config.port, () => {
    console.log(`Server running on ${config.port}`);
    console.log(`SQLite DB path: ${dbMod.getDatabasePath()}`);
    if (!config.storage.bucket) {
        console.log('S3 not configured: set S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY');
    }
});
