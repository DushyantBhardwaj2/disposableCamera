export function findFamilyByToken(db, qrToken) {
    const row = db
        .prepare(`SELECT id, name, slug, qr_token, is_active, created_at
       FROM families
       WHERE qr_token = ? AND is_active = 1
       LIMIT 1`)
        .get(qrToken);
    return row || null;
}
export function getAllFamilies(db) {
    return db
        .prepare(`SELECT id, name, slug, qr_token, is_active, created_at
       FROM families
       ORDER BY name ASC`)
        .all();
}
export function countFamilies(db) {
    const row = db.prepare('SELECT COUNT(1) AS total FROM families').get();
    return Number(row?.total || 0);
}
export function createFamily(db, name, slug, qrToken) {
    const insert = db
        .prepare('INSERT INTO families (name, slug, qr_token, is_active) VALUES (?, ?, ?, 1)')
        .run(name, slug, qrToken);
    const family = db
        .prepare('SELECT id, name, slug, qr_token, is_active, created_at FROM families WHERE id = ?')
        .get(Number(insert.lastInsertRowid));
    return family;
}
export function familyExistsBySlug(db, slug) {
    const row = db.prepare('SELECT 1 FROM families WHERE slug = ? LIMIT 1').get(slug);
    return !!row;
}
export function familyExistsByToken(db, qrToken) {
    const row = db.prepare('SELECT 1 FROM families WHERE qr_token = ? LIMIT 1').get(qrToken);
    return !!row;
}
