import { createS3StorageClient } from './s3';
// Export all storage modules
export * from './types';
export * from './s3';
export * from './validation';
export function createStorageClient(config, origin) {
    if (!config.bucket) {
        return null;
    }
    return createS3StorageClient(config, origin);
}
export function isStorageConfigured(config) {
    return Boolean(config.bucket);
}
