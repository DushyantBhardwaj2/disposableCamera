import Database from 'better-sqlite3'

export interface Family {
  id: number
  name: string
  slug: string
  qr_token: string
  is_active: number
  created_at: string
}

export interface GuestSession {
  id: number
  family_id: number
  display_name: string | null
  session_token: string
  expires_at: string
  created_at: string
}

export interface Photo {
  id: number
  family_id: number
  guest_session_id: number | null
  original_url: string | null
  filtered_url: string | null
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  is_deleted: number
}

export interface Reaction {
  id: number
  photo_id: number
  guest_session_id: number | null
  reaction_type: 'like' | 'skip' | 'superlike'
  created_at: string
}

export interface Comment {
  id: number
  photo_id: number
  guest_session_id: number | null
  display_name: string | null
  body: string
  created_at: string
}

export interface ModerationAction {
  id: number
  photo_id: number
  action: 'approve' | 'reject' | 'delete'
  moderator_name: string | null
  created_at: string
}

export interface AppSetting {
  key: string
  value: string
  updated_at: string
}

export interface PhotoWithDetails extends Photo {
  family_name: string
  guest_name: string | null
}

export interface PhotoFilterOptions {
  search?: string
  family?: string
  family_id?: number
  from?: string
  to?: string
  limit?: number
  offset?: number
}

export interface PaginatedResult<T> {
  items: T[]
  limit: number
  offset: number
  total: number
  has_more: boolean
}

export interface Database {
  prepare(sql: string): import('better-sqlite3').Statement
  exec(sql: string): void
  pragma(pragma: string): unknown
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T
}

export type DatabaseInstance = Database