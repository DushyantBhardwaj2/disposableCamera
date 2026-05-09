export function createPhoto(db, familyId, guestSessionId, originalUrl, filteredUrl, status = 'pending') {
    const insert = db
        .prepare(`INSERT INTO photos (family_id, guest_session_id, original_url, filtered_url, status)
       VALUES (?, ?, ?, ?, ?)`)
        .run(familyId, guestSessionId, originalUrl, filteredUrl, status);
    const photo = db
        .prepare('SELECT id, family_id, guest_session_id, original_url, filtered_url, status, created_at, is_deleted FROM photos WHERE id = ?')
        .get(Number(insert.lastInsertRowid));
    return photo;
}
// NEW: Count photos taken by a session (for disposable camera)
export function countPhotosBySession(db, sessionId) {
    const row = db
        .prepare(`SELECT COUNT(1) AS total
       FROM photos
       WHERE guest_session_id = ? AND status != 'rejected' AND is_deleted = 0`)
        .get(sessionId);
    return Number(row?.total || 0);
}
export function findPhotoById(db, photoId) {
    const row = db
        .prepare(`SELECT id, family_id, guest_session_id, original_url, filtered_url, status, created_at, is_deleted
       FROM photos
       WHERE id = ?
       LIMIT 1`)
        .get(photoId);
    return row || null;
}
export function ensurePhotoInFamily(db, photoId, familyId) {
    const row = db
        .prepare(`SELECT id
       FROM photos
       WHERE id = ? AND family_id = ? AND status = 'approved' AND is_deleted = 0
       LIMIT 1`)
        .get(photoId, familyId);
    return !!row;
}
export function updatePhotoStatus(db, photoId, status) {
    const update = db.prepare("UPDATE photos SET status = ? WHERE id = ?").run(status, photoId);
    return update.changes > 0;
}
export function softDeletePhoto(db, photoId) {
    const update = db.prepare('UPDATE photos SET is_deleted = 1 WHERE id = ?').run(photoId);
    return update.changes > 0;
}
export function countPhotosByStatus(db, status) {
    const row = db
        .prepare(`SELECT COUNT(1) AS total FROM photos WHERE status = ? AND is_deleted = 0`)
        .get(status);
    return Number(row?.total || 0);
}
export function getApprovedPhotos(db, limit = 300, offset = 0) {
    const totalRow = db
        .prepare(`SELECT COUNT(1) AS total
       FROM photos
       WHERE status = 'approved' AND is_deleted = 0`)
        .get();
    const rows = db
        .prepare(`SELECT
         photos.id,
         photos.family_id,
         photos.guest_session_id,
         photos.filtered_url,
         photos.created_at,
         photos.status,
         photos.is_deleted,
         families.name AS family_name,
         guest_sessions.display_name AS guest_name
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE photos.status = 'approved' AND photos.is_deleted = 0
       ORDER BY photos.created_at DESC
       LIMIT ? OFFSET ?`)
        .all(limit, offset);
    const total = Number(totalRow?.total || 0);
    return {
        items: rows,
        limit,
        offset,
        total,
        has_more: offset + rows.length < total,
    };
}
export function getPhotosByStatus(db, status, options = {}) {
    const { search, family, family_id, from, to, limit = 200, offset = 0 } = options;
    const whereParts = [`photos.status = '${status}'`, 'photos.is_deleted = 0'];
    const whereArgs = [];
    if (search) {
        const searchLike = `%${escapeSqlLike(search)}%`;
        whereParts.push("(COALESCE(guest_sessions.display_name, '') LIKE ? ESCAPE '\\' OR families.name LIKE ? ESCAPE '\\')");
        whereArgs.push(searchLike, searchLike);
    }
    if (family) {
        whereParts.push("families.name LIKE ? ESCAPE '\\'");
        whereArgs.push(`%${escapeSqlLike(family)}%`);
    }
    if (family_id) {
        whereParts.push('photos.family_id = ?');
        whereArgs.push(family_id);
    }
    if (from) {
        whereParts.push('date(photos.created_at) >= date(?)');
        whereArgs.push(from);
    }
    if (to) {
        whereParts.push('date(photos.created_at) <= date(?)');
        whereArgs.push(to);
    }
    const whereClause = whereParts.join(' AND ');
    const rows = db
        .prepare(`SELECT
         photos.id,
         photos.family_id,
         photos.guest_session_id,
         photos.original_url,
         photos.filtered_url,
         photos.created_at,
         photos.status,
         photos.is_deleted,
         families.name AS family_name,
         guest_sessions.display_name AS guest_name
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}
       ORDER BY photos.created_at DESC
       LIMIT ? OFFSET ?`)
        .all(...whereArgs, limit, offset);
    const totalRow = db
        .prepare(`SELECT COUNT(1) AS total
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}`)
        .get(...whereArgs);
    const total = Number(totalRow?.total || 0);
    return {
        items: rows,
        limit,
        offset,
        total,
        has_more: offset + rows.length < total,
    };
}
export function bulkUpdatePhotoStatus(db, photoIds, status) {
    const tx = db.transaction((items) => {
        const stmt = db.prepare(`UPDATE photos SET status = '${status}' WHERE id = ? AND is_deleted = 0`);
        let count = 0;
        for (const id of items) {
            const result = stmt.run(id);
            if (result.changes > 0)
                count++;
        }
        return count;
    });
    return tx(photoIds);
}
function escapeSqlLike(value) {
    return value.replace(/[\\%_]/g, '\\$&');
}
