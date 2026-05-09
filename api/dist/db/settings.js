export function getUploadEnabled(db) {
    const row = db
        .prepare("SELECT value FROM app_settings WHERE key = 'upload_enabled' LIMIT 1")
        .get();
    return row ? row.value === '1' : true;
}
export function setUploadEnabled(db, enabled) {
    db
        .prepare(`INSERT INTO app_settings (key, value, updated_at)
       VALUES ('upload_enabled', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
        .run(enabled ? '1' : '0');
}
export function getSetting(db, key) {
    const row = db
        .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
        .get(key);
    return row?.value || null;
}
export function setSetting(db, key, value) {
    db
        .prepare(`INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
        .run(key, value);
}
