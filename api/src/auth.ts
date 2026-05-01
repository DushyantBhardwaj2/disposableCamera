import { Request, Response } from 'express'
import * as crypto from 'node:crypto'

type GuestSession = {
  id: number
  family_id: number
  display_name: string | null
  session_token: string
  expires_at: string
}

export const createAuth = (opts: { db: any; signingSecret: string }) => {
  const { db, signingSecret } = opts

  const base64UrlEncode = (text: string) => Buffer.from(text, 'utf8').toString('base64url')
  const base64UrlDecode = (encoded: string) => Buffer.from(encoded, 'base64url').toString('utf8')

  const signPayload = (payload: Record<string, unknown>) => {
    const encoded = base64UrlEncode(JSON.stringify(payload))
    const signature = crypto.createHmac('sha256', signingSecret).update(encoded).digest('base64url')
    return `v1.${encoded}.${signature}`
  }

  const verifySignedPayload = (token: string) => {
    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== 'v1') return null

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

  const errorJson = (res: Response, error: string, message: string, status: number) => {
    res.status(status).json({ error, message })
  }

  const getSessionTokenFromRequest = (request: Request, bodyToken?: string) => {
    const headerToken = request.header('x-session-token')?.trim()
    if (headerToken) return headerToken

    const auth = request.header('authorization') || ''
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()

    return bodyToken?.trim() || ''
  }

  const getAdminTokenFromRequest = (request: Request, bodyToken?: string) => {
    const headerToken = request.header('x-admin-token')?.trim()
    if (headerToken) return headerToken

    const auth = request.header('authorization') || ''
    if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()

    return bodyToken?.trim() || ''
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
    return signPayload({ role: 'admin', expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString() })
  }

  const verifyAdminToken = (token: string) => {
    const payload = verifySignedPayload(token)
    if (!payload) return false
    if (payload.role !== 'admin') return false
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

  return {
    requireSession,
    requireAdmin,
    createAdminToken,
    verifyAdminToken,
    signPayload,
    verifySignedPayload,
  }
}
