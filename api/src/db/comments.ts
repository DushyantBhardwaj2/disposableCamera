import type { DatabaseInstance, Comment, PaginatedResult } from './types'

export function createComment(
  db: DatabaseInstance,
  photoId: number,
  guestSessionId: number,
  displayName: string | null,
  body: string
): Comment {
  const insert = db
    .prepare('INSERT INTO photo_comments (photo_id, guest_session_id, display_name, body) VALUES (?, ?, ?, ?)')
    .run(photoId, guestSessionId, displayName, body)

  const comment = db
    .prepare('SELECT id, photo_id, guest_session_id, display_name, body, created_at FROM photo_comments WHERE id = ?')
    .get(Number(insert.lastInsertRowid)) as Comment

  return comment
}

export function getCommentsByPhotoId(
  db: DatabaseInstance,
  photoId: number,
  limit: number = 100,
  offset: number = 0
): PaginatedResult<Comment> {
  const totalRow = db
    .prepare('SELECT COUNT(1) AS total FROM photo_comments WHERE photo_id = ?')
    .get(photoId) as { total: number } | undefined

  const rows = db
    .prepare(
      `SELECT id, photo_id, guest_session_id, display_name, body, created_at
       FROM photo_comments
       WHERE photo_id = ?
       ORDER BY created_at ASC
       LIMIT ? OFFSET ?`
    )
    .all(photoId, limit, offset) as Comment[]

  const total = Number(totalRow?.total || 0)
  return {
    items: rows,
    limit,
    offset,
    total,
    has_more: offset + rows.length < total,
  }
}

export function countCommentsByPhotoId(db: DatabaseInstance, photoId: number): number {
  const row = db
    .prepare('SELECT COUNT(1) AS total FROM photo_comments WHERE photo_id = ?')
    .get(photoId) as { total: number } | undefined

  return Number(row?.total || 0)
}