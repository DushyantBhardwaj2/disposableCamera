import * as crypto from 'node:crypto';
export const createAuth = (opts) => {
    const { db, signingSecret } = opts;
    const base64UrlEncode = (text) => Buffer.from(text, 'utf8').toString('base64url');
    const base64UrlDecode = (encoded) => Buffer.from(encoded, 'base64url').toString('utf8');
    const signPayload = (payload) => {
        const encoded = base64UrlEncode(JSON.stringify(payload));
        const signature = crypto.createHmac('sha256', signingSecret).update(encoded).digest('base64url');
        return `v1.${encoded}.${signature}`;
    };
    const verifySignedPayload = (token) => {
        const parts = token.split('.');
        if (parts.length !== 3 || parts[0] !== 'v1')
            return null;
        const [, encodedPayload, providedSig] = parts;
        const expectedSig = crypto.createHmac('sha256', signingSecret).update(encodedPayload).digest('base64url');
        const a = Buffer.from(providedSig);
        const b = Buffer.from(expectedSig);
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return null;
        }
        try {
            const payload = JSON.parse(base64UrlDecode(encodedPayload));
            return payload;
        }
        catch {
            return null;
        }
    };
    const errorJson = (res, error, message, status) => {
        res.status(status).json({ error, message });
    };
    const getSessionTokenFromRequest = (request, bodyToken) => {
        const headerToken = request.header('x-session-token')?.trim();
        if (headerToken)
            return headerToken;
        const auth = request.header('authorization') || '';
        if (auth.toLowerCase().startsWith('bearer '))
            return auth.slice(7).trim();
        return bodyToken?.trim() || '';
    };
    const getAdminTokenFromRequest = (request, bodyToken) => {
        const headerToken = request.header('x-admin-token')?.trim();
        if (headerToken)
            return headerToken;
        const auth = request.header('authorization') || '';
        if (auth.toLowerCase().startsWith('bearer '))
            return auth.slice(7).trim();
        return bodyToken?.trim() || '';
    };
    const requireSession = (request, bodyToken) => {
        const token = getSessionTokenFromRequest(request, bodyToken);
        if (!token) {
            return { ok: false, response: (res) => errorJson(res, 'missing_session', 'session token is required', 401) };
        }
        const session = db
            .prepare(`SELECT id, family_id, display_name, session_token, expires_at
         FROM guest_sessions
         WHERE session_token = ?
         LIMIT 1`)
            .get(token);
        if (!session) {
            return { ok: false, response: (res) => errorJson(res, 'invalid_session', 'Session not found', 401) };
        }
        if (new Date(session.expires_at).getTime() < Date.now()) {
            return { ok: false, response: (res) => errorJson(res, 'expired_session', 'Session has expired', 401) };
        }
        return { ok: true, session };
    };
    const createAdminToken = () => {
        return signPayload({ role: 'admin', expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() });
    };
    const verifyAdminToken = (token) => {
        const payload = verifySignedPayload(token);
        if (!payload)
            return false;
        if (payload.role !== 'admin')
            return false;
        const exp = typeof payload.expires_at === 'string' ? payload.expires_at : '';
        return !!exp && new Date(exp).getTime() > Date.now();
    };
    const requireAdmin = (request, bodyToken) => {
        const token = getAdminTokenFromRequest(request, bodyToken);
        if (!token) {
            return { ok: false, response: (res) => errorJson(res, 'missing_admin', 'Admin token is required', 401) };
        }
        if (!verifyAdminToken(token)) {
            return { ok: false, response: (res) => errorJson(res, 'invalid_admin', 'Invalid or expired admin token', 401) };
        }
        return { ok: true };
    };
    return {
        requireSession,
        requireAdmin,
        createAdminToken,
        verifyAdminToken,
        signPayload,
        verifySignedPayload,
    };
};
