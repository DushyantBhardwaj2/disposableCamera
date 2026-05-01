import type { DatabaseInstance, ModerationAction } from './types'

export function createModerationAction(
  db: DatabaseInstance,
  photoId: number,
  action: 'approve' | 'reject' | 'delete',
  moderatorName: string | null = 'admin'
): ModerationAction {
  const insert = db
    .prepare('INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, ?, ?)')
    .run(photoId, action, moderatorName)

  const moderationAction = db
    .prepare('SELECT id, photo_id, action, moderator_name, created_at FROM moderation_actions WHERE id = ?')
    .get(Number(insert.lastInsertRowid)) as ModerationAction

  return moderationAction
}

export function bulkCreateModerationActions(
  db: DatabaseInstance,
  photoIds: number[],
  action: 'approve' | 'reject' | 'delete',
  moderatorName: string | null = 'admin'
): number {
  const tx = db.transaction((items: number[]) => {
    const stmt = db.prepare('INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, ?, ?)')
    let count = 0
    for (const id of items) {
      stmt.run(id, action, moderatorName)
      count++
    }
    return count
  })

  return tx(photoIds)
}

export function getModerationActionsByPhotoId(db: DatabaseInstance, photoId: number): ModerationAction[] {
  return db
    .prepare(
      `SELECT id, photo_id, action, moderator_name, created_at
       FROM moderation_actions
       WHERE photo_id = ?
       ORDER BY created_at DESC`
    )
    .all(photoId) as ModerationAction[]
}

export function bulkApprovePhotos(db: DatabaseInstance, photoIds: number[]): number {
  const tx = db.transaction((items: number[]) => {
    const approveStmt = db.prepare("UPDATE photos SET status = 'approved' WHERE id = ? AND is_deleted = 0")
    const actionStmt = db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'approve', 'admin')")
    let count = 0
    for (const id of items) {
      const result = approveStmt.run(id)
      if (result.changes > 0) {
        actionStmt.run(id)
        count++
      }
    }
    return count
  })

  return tx(photoIds)
}

export function bulkRejectPhotos(db: DatabaseInstance, photoIds: number[]): number {
  const tx = db.transaction((items: number[]) => {
    const rejectStmt = db.prepare("UPDATE photos SET status = 'rejected' WHERE id = ? AND is_deleted = 0")
    const actionStmt = db.prepare("INSERT INTO moderation_actions (photo_id, action, moderator_name) VALUES (?, 'reject', 'admin')")
    let count = 0
    for (const id of items) {
      const result = rejectStmt.run(id)
      if (result.changes > 0) {
        actionStmt.run(id)
        count++
      }
    }
    return count
  })

  return tx(photoIds)
}