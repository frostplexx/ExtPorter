import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';
import { FileContentUpdater } from '../../utils/file_content_updater';
import { DownloadResult } from './types';

/**
 * Updates references to remote URLs with local paths
 */
export function updateReferencesToLocal(
    extension: Extension,
    downloadResults: DownloadResult[]
): Extension {
    const urlMapping = new Map<string, string>();

    // Build mapping of remote URLs to local paths
    downloadResults.forEach((result) => {
        if (result.success && result.localPath) {
            urlMapping.set(result.url, result.localPath);
        }
    });

    if (urlMapping.size === 0) {
        return extension;
    }

    // Update manifest
    extension.manifest = replaceUrlsInObject(extension.manifest, urlMapping);

    // Update file contents
    extension.files.forEach((file) => {
        if (
            file.filetype === ExtFileType.JS ||
            file.filetype === ExtFileType.CSS ||
            file.filetype === ExtFileType.HTML ||
            file.filetype === ExtFileType.OTHER
        ) {
            try {
                const originalContent = file.getContent();
                const updatedContent = replaceUrlsInContent(originalContent, urlMapping);

                if (originalContent !== updatedContent) {
                    logger.debug(extension, `Updated resource references in: ${file.path}`);

                    // Update the file content using our utility
                    try {
                        FileContentUpdater.updateFileContent(file, updatedContent);
                    } catch (updateError) {
                        logger.warn(
                            extension,
                            `Failed to write updated content to file: ${file.path}: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
                            {
                                error:
                                    updateError instanceof Error
                                        ? {
                                              message: updateError.message,
                                              stack: updateError.stack,
                                              name: updateError.name,
                                          }
                                        : String(updateError),
                            }
                        );
                    }
                }
            } catch (error) {
                logger.warn(extension, `Failed to update references in file: ${file.path}`, {
                    error,
                });
            }
        }
    });

    return extension;
}

/**
 * Recursively replaces URLs in an object (for manifest)
 */
export function replaceUrlsInObject(obj: any, urlMapping: Map<string, string>): any {
    if (!obj) return obj;

    if (typeof obj === 'string') {
        return replaceUrlsInContent(obj, urlMapping);
    } else if (Array.isArray(obj)) {
        return obj.map((item) => replaceUrlsInObject(item, urlMapping));
    } else if (typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
            result[key] = replaceUrlsInObject(value, urlMapping);
        }
        return result;
    }

    return obj;
}

/**
 * Replaces remote URLs with local paths in content
 */
export function replaceUrlsInContent(content: string, urlMapping: Map<string, string>): string {
    let updatedContent = content;

    urlMapping.forEach((localPath, remoteUrl) => {
        // Replace all occurrences of the remote URL with the local path
        const escapedUrl = remoteUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedUrl, 'g');
        updatedContent = updatedContent.replace(regex, localPath);
    });

    return updatedContent;
}
