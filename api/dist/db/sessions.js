export function createGuestSession(db, familyId, displayName, sessionToken, expiresAt) {
    const insert = db
        .prepare(`INSERT INTO guest_sessions (family_id, display_name, session_token, expires_at)
       VALUES (?, ?, ?, ?)`)
        .run(familyId, displayName, sessionToken, expiresAt);
    const session = db
        .prepare('SELECT id, family_id, display_name, session_token, expires_at, created_at FROM guest_sessions WHERE id = ?')
        .get(Number(insert.lastInsertRowid));
    return session;
}
export function findSessionByToken(db, sessionToken) {
    const row = db
        .prepare(`SELECT id, family_id, display_name, session_token, expires_at, created_at
       FROM guest_sessions
       WHERE session_token = ?
       LIMIT 1`)
        .get(sessionToken);
    return row || null;
}
export function countActiveSessions(db) {
    const row = db
        .prepare('SELECT COUNT(1) AS total FROM guest_sessions WHERE datetime(expires_at) > datetime(\'now\')')
        .get();
    return Number(row?.total || 0);
}
export function isSessionValid(db, sessionToken) {
    const row = db
        .prepare(`SELECT 1
       FROM guest_sessions
       WHERE session_token = ? AND datetime(expires_at) > datetime('now')
       LIMIT 1`)
        .get(sessionToken);
    return !!row;
}
