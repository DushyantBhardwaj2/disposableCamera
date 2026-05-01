import type { StorageClient, StorageConfig } from './types'
import { createS3StorageClient } from './s3'

// Export all storage modules
export * from './types'
export * from './s3'
export * from './validation'

export function createStorageClient(config: StorageConfig, origin: string): StorageClient | null {
  if (!config.bucket) {
    return null
  }

  return createS3StorageClient(config, origin)
}

export function isStorageConfigured(config: StorageConfig): boolean {
  return Boolean(config.bucket)
}