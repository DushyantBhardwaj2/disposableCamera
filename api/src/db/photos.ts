import type { DatabaseInstance, Photo, PhotoWithDetails, PhotoFilterOptions, PaginatedResult } from './types'

export function createPhoto(
  db: DatabaseInstance,
  familyId: number,
  guestSessionId: number,
  originalUrl: string,
  filteredUrl: string,
  status: 'pending' | 'approved' | 'rejected' = 'pending'
): Photo {
  const insert = db
    .prepare(
      `INSERT INTO photos (family_id, guest_session_id, original_url, filtered_url, status)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(familyId, guestSessionId, originalUrl, filteredUrl, status)

  const photo = db
    .prepare('SELECT id, family_id, guest_session_id, original_url, filtered_url, status, created_at, is_deleted FROM photos WHERE id = ?')
    .get(Number(insert.lastInsertRowid)) as Photo

  return photo
}

export function findPhotoById(db: DatabaseInstance, photoId: number): Photo | null {
  const row = db
    .prepare(
      `SELECT id, family_id, guest_session_id, original_url, filtered_url, status, created_at, is_deleted
       FROM photos
       WHERE id = ?
       LIMIT 1`
    )
    .get(photoId) as Photo | undefined

  return row || null
}

export function ensurePhotoInFamily(db: DatabaseInstance, photoId: number, familyId: number): boolean {
  const row = db
    .prepare(
      `SELECT id
       FROM photos
       WHERE id = ? AND family_id = ? AND status = 'approved' AND is_deleted = 0
       LIMIT 1`
    )
    .get(photoId, familyId) as { id: number } | undefined

  return !!row
}

export function updatePhotoStatus(db: DatabaseInstance, photoId: number, status: 'approved' | 'rejected'): boolean {
  const update = db.prepare("UPDATE photos SET status = ? WHERE id = ?").run(status, photoId)
  return update.changes > 0
}

export function softDeletePhoto(db: DatabaseInstance, photoId: number): boolean {
  const update = db.prepare('UPDATE photos SET is_deleted = 1 WHERE id = ?').run(photoId)
  return update.changes > 0
}

export function countPhotosByStatus(db: DatabaseInstance, status: 'pending' | 'approved' | 'rejected'): number {
  const row = db
    .prepare(`SELECT COUNT(1) AS total FROM photos WHERE status = ? AND is_deleted = 0`)
    .get(status) as { total: number } | undefined

  return Number(row?.total || 0)
}

export function getApprovedPhotos(
  db: DatabaseInstance,
  limit: number = 300,
  offset: number = 0
): PaginatedResult<PhotoWithDetails> {
  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS total
       FROM photos
       WHERE status = 'approved' AND is_deleted = 0`
    )
    .get() as { total: number } | undefined

  const rows = db
    .prepare(
      `SELECT
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
       LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as PhotoWithDetails[]

  const total = Number(totalRow?.total || 0)
  return {
    items: rows,
    limit,
    offset,
    total,
    has_more: offset + rows.length < total,
  }
}

export function getPhotosByStatus(
  db: DatabaseInstance,
  status: 'pending' | 'approved' | 'rejected',
  options: PhotoFilterOptions = {}
): PaginatedResult<PhotoWithDetails> {
  const { search, family, family_id, from, to, limit = 200, offset = 0 } = options

  const whereParts = [`photos.status = '${status}'`, 'photos.is_deleted = 0']
  const whereArgs: Array<string | number> = []

  if (search) {
    const searchLike = `%${escapeSqlLike(search)}%`
    whereParts.push("(COALESCE(guest_sessions.display_name, '') LIKE ? ESCAPE '\\' OR families.name LIKE ? ESCAPE '\\')")
    whereArgs.push(searchLike, searchLike)
  }
  if (family) {
    whereParts.push("families.name LIKE ? ESCAPE '\\'")
    whereArgs.push(`%${escapeSqlLike(family)}%`)
  }
  if (family_id) {
    whereParts.push('photos.family_id = ?')
    whereArgs.push(family_id)
  }
  if (from) {
    whereParts.push('date(photos.created_at) >= date(?)')
    whereArgs.push(from)
  }
  if (to) {
    whereParts.push('date(photos.created_at) <= date(?)')
    whereArgs.push(to)
  }

  const whereClause = whereParts.join(' AND ')

  const rows = db
    .prepare(
      `SELECT
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
       LIMIT ? OFFSET ?`
    )
    .all(...whereArgs, limit, offset) as PhotoWithDetails[]

  const totalRow = db
    .prepare(
      `SELECT COUNT(1) AS total
       FROM photos
       JOIN families ON families.id = photos.family_id
       LEFT JOIN guest_sessions ON guest_sessions.id = photos.guest_session_id
       WHERE ${whereClause}`
    )
    .get(...whereArgs) as { total: number } | undefined

  const total = Number(totalRow?.total || 0)
  return {
    items: rows,
    limit,
    offset,
    total,
    has_more: offset + rows.length < total,
  }
}

export function bulkUpdatePhotoStatus(
  db: DatabaseInstance,
  photoIds: number[],
  status: 'approved' | 'rejected'
): number {
  const tx = db.transaction((items: number[]) => {
    const stmt = db.prepare(`UPDATE photos SET status = '${status}' WHERE id = ? AND is_deleted = 0`)
    let count = 0
    for (const id of items) {
      const result = stmt.run(id)
      if (result.changes > 0) count++
    }
    return count
  })

  return tx(photoIds)
}

function escapeSqlLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}