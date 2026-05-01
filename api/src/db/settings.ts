import type { DatabaseInstance } from './types'

export function getUploadEnabled(db: DatabaseInstance): boolean {
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = 'upload_enabled' LIMIT 1")
    .get() as { value: string } | undefined

  return row ? row.value === '1' : true
}

export function setUploadEnabled(db: DatabaseInstance, enabled: boolean): void {
  db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES ('upload_enabled', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .run(enabled ? '1' : '0')
}

export function getSetting(db: DatabaseInstance, key: string): string | null {
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ? LIMIT 1')
    .get(key) as { value: string } | undefined

  return row?.value || null
}

export function setSetting(db: DatabaseInstance, key: string, value: string): void {
  db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, value)
}