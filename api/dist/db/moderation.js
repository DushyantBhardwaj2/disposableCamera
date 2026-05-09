export function createModerationAction(db, photoId, action, moderatorName = 'admin') {
    const insert = db
        .prepare('INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, ?, ?)')
        .run(photoId, action, moderatorName);
    const moderationAction = db
        .prepare('SELECT id, photo_id, action, moderator_name, created_at FROM moderation_actions WHERE id = ?')
        .get(Number(insert.lastInsertRowid));
    return moderationAction;
}
export function bulkCreateModerationActions(db, photoIds, action, moderatorName = 'admin') {
    const tx = db.transaction((items) => {
        const stmt = db.prepare('INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, ?, ?)');
        let count = 0;
        for (const id of items) {
            stmt.run(id, action, moderatorName);
            count++;
        }
        return count;
    });
    return tx(photoIds);
}
export function getModerationActionsByPhotoId(db, photoId) {
    return db
        .prepare(`SELECT id, photo_id, action, moderator_name, created_at
       FROM moderation_actions
       WHERE photo_id = ?
       ORDER BY created_at DESC`)
        .all(photoId);
}
export function bulkApprovePhotos(db, photoIds) {
    const tx = db.transaction((items) => {
        const approveStmt = db.prepare("UPDATE photos SET status = 'approved' WHERE id = ? AND is_deleted = 0");
        const actionStmt = db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'approve', 'admin')");
        let count = 0;
        for (const id of items) {
            const result = approveStmt.run(id);
            if (result.changes > 0) {
                actionStmt.run(id);
                count++;
            }
        }
        return count;
    });
    return tx(photoIds);
}
export function bulkRejectPhotos(db, photoIds) {
    const tx = db.transaction((items) => {
        const rejectStmt = db.prepare("UPDATE photos SET status = 'rejected' WHERE id = ? AND is_deleted = 0");
        const actionStmt = db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'reject', 'admin')");
        let count = 0;
        for (const id of items) {
            const result = rejectStmt.run(id);
            if (result.changes > 0) {
                actionStmt.run(id);
                count++;
            }
        }
        return count;
    });
    return tx(photoIds);
}
