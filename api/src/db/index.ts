import Database from 'better-sqlite3'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '../config'
import type { DatabaseInstance } from './types'

// Export all database modules
export * from './types'
export * from './families'
export * from './sessions'
export * from './photos'
export * from './comments'
export * from './reactions'
export * from './moderation'
export * from './settings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..', '..')
const dataDir = path.join(rootDir, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const resolveDbPath = () => {
  if (config.sqlitePathInput) {
    if (path.isAbsolute(config.sqlitePathInput)) {
      return config.sqlitePathInput
    }
    // If Render disk exists, place relative sqlite path on persistent storage.
    if (config.renderDiskPath) {
      return path.join(config.renderDiskPath, config.sqlitePathInput.replace(/^\.\//, ''))
    }
    return path.resolve(rootDir, config.sqlitePathInput)
  }

  if (config.renderDiskPath) {
    return path.join(config.renderDiskPath, 'wedding.db')
  }

  return path.join(dataDir, 'wedding.db')
}

const dbPath = resolveDbPath()
fs.mkdirSync(path.dirname(dbPath), { recursive: true })

export function createDatabase(): DatabaseInstance {
  const db = new Database(dbPath)
  db.pragma('foreign_keys = ON')
  return db
}

export function applyMigrations(db: DatabaseInstance): void {
  const migrationDir = path.join(rootDir, 'migrations')
  if (!fs.existsSync(migrationDir)) {
    return
  }

  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))

  for (const fileName of files) {
    const sql = fs.readFileSync(path.join(migrationDir, fileName), 'utf8')
    try {
      db.exec(sql)
    } catch (error) {
      const message = String((error as Error)?.message || '').toLowerCase()
      // Allow idempotent re-runs for ALTER TABLE ADD COLUMN migrations.
      if (message.includes('duplicate column name')) {
        continue
      }
      throw error
    }
  }
}

export function seedDefaultFamilies(db: DatabaseInstance): void {
  const seedPath = path.join(rootDir, 'migrations', '0002_seed_families.sql')
  if (!fs.existsSync(seedPath)) {
    return
  }
  const sql = fs.readFileSync(seedPath, 'utf8')
  db.exec(sql)
}

export function getDatabasePath(): string {
  return dbPath
}

export function getRenderDiskPath(): string {
  return config.renderDiskPath
}