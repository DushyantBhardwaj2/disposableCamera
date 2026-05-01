import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Readable } from 'node:stream'

import type { StorageClient, StorageConfig, StorageResult, FileResult, UploadMetadata } from './types'
import { toPublicMediaUrl } from './validation'

export class S3StorageClient implements StorageClient {
  private client: S3Client
  private bucket: string
  private origin: string

  constructor(config: StorageConfig, origin: string) {
    this.bucket = config.bucket
    this.origin = origin

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: config.accessKeyId && config.secretAccessKey
        ? {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          }
        : undefined,
    })
  }

  async uploadFile(key: string, data: Buffer, metadata?: UploadMetadata): Promise<StorageResult> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: data,
          ContentType: metadata?.contentType,
          CacheControl: metadata?.cacheControl || 'public, max-age=31536000, immutable',
        })
      )

      const url = `s3://${key}`
      return {
        success: true,
        key,
        url,
      }
    } catch (error) {
      return {
        success: false,
        error: String((error as Error)?.message || 'Unknown S3 upload error'),
      }
    }
  }

  async getFile(key: string): Promise<FileResult> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      const bytes = await this.readBodyToBuffer(result.Body)

      return {
        success: true,
        data: bytes,
        contentType: result.ContentType,
      }
    } catch (error) {
      return {
        success: false,
        error: String((error as Error)?.message || 'Unknown S3 get error'),
      }
    }
  }

  getPublicUrl(key: string): string {
    const rawUrl = `s3://${key}`
    return toPublicMediaUrl(this.origin, rawUrl) || rawUrl
  }

  validateUpload(_fileName: string, _fileType: string, _size: number): import('./types').ValidationResult {
    // This is handled by the validation module
    return { valid: true }
  }

  private async readBodyToBuffer(body: unknown): Promise<Buffer> {
    if (!body) {
      return Buffer.alloc(0)
    }

    if (Buffer.isBuffer(body)) {
      return body
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body)
    }

    if (typeof body === 'string') {
      return Buffer.from(body)
    }

    if (body instanceof Readable) {
      const chunks: Buffer[] = []
      for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    }

    if (typeof body === 'object' && body !== null && 'transformToByteArray' in body) {
      const arr = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray()
      return Buffer.from(arr)
    }

    return Buffer.alloc(0)
  }
}

export function createS3StorageClient(config: StorageConfig, origin: string): S3StorageClient {
  return new S3StorageClient(config, origin)
}