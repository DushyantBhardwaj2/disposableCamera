import type { DatabaseInstance, Family } from './types'

export function findFamilyByToken(db: DatabaseInstance, qrToken: string): Family | null {
  const row = db
    .prepare(
      `SELECT id, name, slug, qr_token, is_active, created_at
       FROM families
       WHERE qr_token = ? AND is_active = 1
       LIMIT 1`
    )
    .get(qrToken) as Family | undefined

  return row || null
}

export function getAllFamilies(db: DatabaseInstance): Family[] {
  return db
    .prepare(
      `SELECT id, name, slug, qr_token, is_active, created_at
       FROM families
       ORDER BY name ASC`
    )
    .all() as Family[]
}

export function countFamilies(db: DatabaseInstance): number {
  const row = db.prepare('SELECT COUNT(1) AS total FROM families').get() as { total: number } | undefined
  return Number(row?.total || 0)
}

export function createFamily(
  db: DatabaseInstance,
  name: string,
  slug: string,
  qrToken: string
): Family {
  const insert = db
    .prepare('INSERT INTO families (name, slug, qr_token, is_active) VALUES (?, ?, ?, 1)')
    .run(name, slug, qrToken)

  const family = db
    .prepare('SELECT id, name, slug, qr_token, is_active, created_at FROM families WHERE id = ?')
    .get(Number(insert.lastInsertRowid)) as Family

  return family
}

export function familyExistsBySlug(db: DatabaseInstance, slug: string): boolean {
  const row = db.prepare('SELECT 1 FROM families WHERE slug = ? LIMIT 1').get(slug) as { 1: number } | undefined
  return !!row
}

export function familyExistsByToken(db: DatabaseInstance, qrToken: string): boolean {
  const row = db.prepare('SELECT 1 FROM families WHERE qr_token = ? LIMIT 1').get(qrToken) as { 1: number } | undefined
  return !!row
}