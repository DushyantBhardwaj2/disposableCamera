export function createComment(db, photoId, guestSessionId, displayName, body) {
    const insert = db
        .prepare('INSERT INTO photo_comments (photo_id, guest_session_id, display_name, body) VALUES (?, ?, ?, ?)')
        .run(photoId, guestSessionId, displayName, body);
    const comment = db
        .prepare('SELECT id, photo_id, guest_session_id, display_name, body, created_at FROM photo_comments WHERE id = ?')
        .get(Number(insert.lastInsertRowid));
    return comment;
}
export function getCommentsByPhotoId(db, photoId, limit = 100, offset = 0) {
    const totalRow = db
        .prepare('SELECT COUNT(1) AS total FROM photo_comments WHERE photo_id = ?')
        .get(photoId);
    const rows = db
        .prepare(`SELECT id, photo_id, guest_session_id, display_name, body, created_at
       FROM photo_comments
       WHERE photo_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`)
        .all(photoId, limit, offset);
    const total = Number(totalRow?.total || 0);
    return {
        items: rows,
        limit,
        offset,
        total,
        has_more: offset + rows.length < total,
    };
}
export function countCommentsByPhotoId(db, photoId) {
    const row = db
        .prepare('SELECT COUNT(1) AS total FROM photo_comments WHERE photo_id = ?')
        .get(photoId);
    return Number(row?.total || 0);
}
