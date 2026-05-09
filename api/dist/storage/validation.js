import { config } from '../config';
const ALLOWED_UPLOAD_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
export function validateUpload(fileName, fileType, size) {
    if (!fileName || !fileType) {
        return { valid: false, error: 'file_name and file_type are required' };
    }
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(fileType.toLowerCase())) {
        return { valid: false, error: 'Only JPEG, PNG, WEBP and GIF uploads are allowed' };
    }
    if (size > config.maxUploadBytes) {
        return { valid: false, error: `File size exceeds ${config.maxUploadBytes} bytes` };
    }
    return { valid: true };
}
export function extensionFromType(fileName, fileType) {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg'))
        return 'jpg';
    if (lowerName.endsWith('.png'))
        return 'png';
    if (lowerName.endsWith('.webp'))
        return 'webp';
    if (lowerName.endsWith('.gif'))
        return 'gif';
    const lowerType = fileType.toLowerCase();
    if (lowerType.includes('jpeg'))
        return 'jpg';
    if (lowerType.includes('png'))
        return 'png';
    if (lowerType.includes('webp'))
        return 'webp';
    if (lowerType.includes('gif'))
        return 'gif';
    return 'jpg';
}
export function toPublicMediaUrl(origin, rawUrl) {
    if (!rawUrl) {
        return null;
    }
    const asKey = (prefix) => {
        const key = rawUrl.slice(prefix.length);
        return `${origin}/api/media?key=${encodeURIComponent(key)}`;
    };
    if (rawUrl.startsWith('s3://')) {
        return asKey('s3://');
    }
    if (rawUrl.startsWith('r2://')) {
        return asKey('r2://');
    }
    if (rawUrl.startsWith('local://uploads/')) {
        return asKey('local://uploads/');
    }
    return rawUrl;
}
export function getMaxUploadBytes() {
    return config.maxUploadBytes;
}
export function getAllowedMimeTypes() {
    return new Set(ALLOWED_UPLOAD_MIME_TYPES);
}
