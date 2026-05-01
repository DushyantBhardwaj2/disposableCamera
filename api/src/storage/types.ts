export interface StorageConfig {
  bucket: string
  region: string
  endpoint?: string
  forcePathStyle?: boolean
  accessKeyId?: string
  secretAccessKey?: string
}

export interface UploadMetadata {
  contentType?: string
  cacheControl?: string
}

export interface StorageResult {
  success: boolean
  key?: string
  url?: string
  error?: string
}

export interface FileResult {
  success: boolean
  data?: Buffer
  contentType?: string
  error?: string
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface StorageClient {
  uploadFile(key: string, data: Buffer, metadata?: UploadMetadata): Promise<StorageResult>
  getFile(key: string): Promise<FileResult>
  getPublicUrl(key: string): string
  validateUpload(fileName: string, fileType: string, size: number): ValidationResult
}