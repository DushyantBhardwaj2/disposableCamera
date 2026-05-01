import type { DatabaseInstance, Reaction } from './types'

export function createReaction(
  db: DatabaseInstance,
  photoId: number,
  guestSessionId: number,
  reactionType: 'like' | 'skip' | 'superlike'
): Reaction {
  const insert = db
    .prepare('INSERT INTO reactions (photo_id, guest_session_id, reaction_type) VALUES (?, ?, ?)')
    .run(photoId, guestSessionId, reactionType)

  const reaction = db
    .prepare('SELECT id, photo_id, guest_session_id, reaction_type, created_at FROM reactions WHERE id = ?')
    .get(Number(insert.lastInsertRowid)) as Reaction

  return reaction
}

export function getReactionsByPhotoId(db: DatabaseInstance, photoId: number): Reaction[] {
  return db
    .prepare(
      `SELECT id, photo_id, guest_session_id, reaction_type, created_at
       FROM reactions
       WHERE photo_id = ?
       ORDER BY created_at DESC`
    )
    .all(photoId) as Reaction[]
}

export function countReactionsByPhotoId(db: DatabaseInstance, photoId: number): number {
  const row = db
    .prepare('SELECT COUNT(1) AS total FROM reactions WHERE photo_id = ?')
    .get(photoId) as { total: number } | undefined

  return Number(row?.total || 0)
}