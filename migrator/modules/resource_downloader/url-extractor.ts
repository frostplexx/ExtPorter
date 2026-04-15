import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { RemoteResource, URL_PATTERNS } from './types';
import { generateLocalPath } from './path-generator';
import { logger } from '../../utils/logger';

/**
 * Finds all remote resources in an extension
 */
export function findRemoteResources(extension: Extension): RemoteResource[] {
    const resources = new Set<string>();

    // Search in manifest
    extractUrlsFromObject(extension.manifest, resources);

    // Search in all files
    extension.files.forEach((file) => {

        if (!file) {
            logger.error(extension, "File is null");
            return;
        }
        if (
            file.filetype === ExtFileType.JS ||
            file.filetype === ExtFileType.CSS ||
            file.filetype === ExtFileType.HTML ||
            file.filetype === ExtFileType.OTHER
        ) {
            const content = file.getContent();
            extractUrlsFromContent(content, resources);
        }
    });

    return Array.from(resources).map((url) => ({
        url,
        localPath: generateLocalPath(url),
    }));
}

/**
 * Recursively extracts URLs from an object (for manifest processing)
 */
export function extractUrlsFromObject(obj: any, resources: Set<string>): void {
    if (!obj) return;

    if (typeof obj === 'string') {
        extractUrlsFromContent(obj, resources);
    } else if (Array.isArray(obj)) {
        obj.forEach((item) => extractUrlsFromObject(item, resources));
    } else if (typeof obj === 'object') {
        Object.values(obj).forEach((value) => extractUrlsFromObject(value, resources));
    }
}

/**
 * Extracts URLs from content using predefined patterns
 */
export function extractUrlsFromContent(content: string, resources: Set<string>): void {
    URL_PATTERNS.forEach((pattern) => {
        const matches = content.match(pattern);
        if (matches) {
            matches.forEach((url) => {
                // Clean up URL (remove quotes, trailing punctuation, etc.)
                let cleanUrl = url.replace(/['"]/g, '').trim();
                // Remove trailing semicolons, commas, and other punctuation
                cleanUrl = cleanUrl.replace(/[;,)}\]]+$/, '');
                if (isValidResourceUrl(cleanUrl)) {
                    resources.add(cleanUrl);
                }
            });
        }
    });
}

/**
 * Validates whether a URL is a valid remote resource
 */
export function isValidResourceUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return (
            parsed.protocol === 'https:' &&
            !url.includes('localhost') &&
            !url.includes('127.0.0.1') &&
            !url.includes('example.com')
        );
    } catch {
        return false;
    }
}
