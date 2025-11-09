import * as crypto from 'crypto';
import * as path from 'path';

/**
 * Generates a local path for a remote resource
 */
export function generateLocalPath(url: string): string {
    const parsed = new URL(url);
    const hash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);

    let filename = path.basename(parsed.pathname) || 'index';
    const extension = path.extname(filename);

    if (!extension) {
        // Determine extension from URL or content-type
        if (url.includes('googleapis.com/css') || url.includes('fonts.googleapis.com')) {
            filename += '.css';
        } else if (url.includes('.js')) {
            filename += '.js';
        } else {
            filename += '.txt';
        }
    }

    // Generate path without hostname to avoid domain names in the final path
    return `remote_resources/${hash}_${filename}`;
}

/**
 * Infers content type from a URL
 */
export function inferContentType(url: string): string {
    const fileExt = path.extname(new URL(url).pathname).toLowerCase();

    switch (fileExt) {
        case '.css':
            return 'text/css';
        case '.js':
            return 'application/javascript';
        case '.json':
            return 'application/json';
        case '.woff':
        case '.woff2':
            return 'font/woff';
        case '.ttf':
            return 'font/ttf';
        case '.eot':
            return 'application/vnd.ms-fontobject';
        case '.svg':
            return 'image/svg+xml';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.gif':
            return 'image/gif';
        default:
            return 'application/octet-stream';
    }
}
