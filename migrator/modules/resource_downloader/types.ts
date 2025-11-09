export interface RemoteResource {
    url: string;
    localPath: string;
    contentType?: string;
    size?: number;
}

export interface DownloadResult {
    success: boolean;
    url: string;
    localPath?: string;
    error?: string;
    contentType?: string;
    size?: number;
}

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
export const TIMEOUT_MS = 10000; // 10 seconds
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Common CDN and resource patterns
export const URL_PATTERNS = [
    // Google Fonts
    /https:\/\/fonts\.googleapis\.com\/css[^"'\s]*/g,
    /https:\/\/fonts\.gstatic\.com\/[^"'\s]*/g,

    // Popular CDNs
    /https:\/\/cdn\.jsdelivr\.net\/[^"'\s]*/g,
    /https:\/\/unpkg\.com\/[^"'\s]*/g,
    /https:\/\/cdnjs\.cloudflare\.com\/[^"'\s]*/g,
    /https:\/\/stackpath\.bootstrapcdn\.com\/[^"'\s]*/g,

    // Google APIs
    /https:\/\/[^/]*\.googleapis\.com\/[^"'\s]*/g,

    // Generic HTTPS resources
    /https:\/\/[^/\s"']+\.[^/\s"']+\/[^"'\s]*\.(js|css|woff|woff2|ttf|eot|svg|png|jpg|jpeg|gif|ico)(?:[?#][^"'\s]*)?/gi,
];
