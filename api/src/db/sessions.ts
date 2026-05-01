import type { DatabaseInstance, GuestSession } from './types'

export function createGuestSession(
  db: DatabaseInstance,
  familyId: number,
  displayName: string | null,
  sessionToken: string,
  expiresAt: string
): GuestSession {
  const insert = db
    .prepare(
      `INSERT INTO guest_sessions (family_id, display_name, session_token, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(familyId, displayName, sessionToken, expiresAt)

  const session = db
    .prepare('SELECT id, family_id, display_name, session_token, expires_at, created_at FROM guest_sessions WHERE id = ?')
    .get(Number(insert.lastInsertRowid)) as GuestSession

  return session
}

export function findSessionByToken(db: DatabaseInstance, sessionToken: string): GuestSession | null {
  const row = db
    .prepare(
      `SELECT id, family_id, display_name, session_token, expires_at, created_at
       FROM guest_sessions
       WHERE session_token = ?
       LIMIT 1`
    )
    .get(sessionToken) as GuestSession | undefined

  return row || null
}

export function countActiveSessions(db: DatabaseInstance): number {
  const row = db
    .prepare('SELECT COUNT(1) AS total FROM guest_sessions WHERE datetime(expires_at) > datetime(\'now\')')
    .get() as { total: number } | undefined

  return Number(row?.total || 0)
}

export function isSessionValid(db: DatabaseInstance, sessionToken: string): boolean {
  const row = db
    .prepare(
      `SELECT 1
       FROM guest_sessions
       WHERE session_token = ? AND datetime(expires_at) > datetime('now')
       LIMIT 1`
    )
    .get(sessionToken) as { 1: number } | undefined

  return !!row
}