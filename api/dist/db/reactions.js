export function createReaction(db, photoId, guestSessionId, reactionType) {
    const insert = db
        .prepare('INSERT INTO reactions (photo_id, guest_session_id, reaction_type) VALUES (?, ?, ?)')
        .run(photoId, guestSessionId, reactionType);
    const reaction = db
        .prepare('SELECT id, photo_id, guest_session_id, reaction_type, created_at FROM reactions WHERE id = ?')
        .get(Number(insert.lastInsertRowid));
    return reaction;
}
export function getReactionsByPhotoId(db, photoId) {
    return db
        .prepare(`SELECT id, photo_id, guest_session_id, reaction_type, created_at
       FROM reactions
       WHERE photo_id = ?
       ORDER BY created_at DESC`)
        .all(photoId);
}
export function countReactionsByPhotoId(db, photoId) {
    const row = db
        .prepare('SELECT COUNT(1) AS total FROM reactions WHERE photo_id = ?')
        .get(photoId);
    return Number(row?.total || 0);
}
