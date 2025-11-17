import * as path from 'path';
import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';
import { globals } from '../../index';

/**
 * Determines the file type from a URL and file extension
 */
export function determineFileType(localPath: string, originalUrl: string): ExtFileType {
    const fileExtension = path.extname(localPath).toLowerCase();

    // Check file extension first
    switch (fileExtension) {
        case '.js':
            return ExtFileType.JS;
        case '.css':
            return ExtFileType.CSS;
        case '.html':
        case '.htm':
            return ExtFileType.HTML;
        default:
            // For files without extensions, infer from URL
            if (
                originalUrl.includes('googleapis.com/css') ||
                originalUrl.includes('fonts.googleapis.com')
            ) {
                return ExtFileType.CSS;
            } else if (originalUrl.includes('.js') || originalUrl.includes('javascript')) {
                return ExtFileType.JS;
            } else {
                return ExtFileType.OTHER;
            }
    }
}

/**
 * Adds a downloaded file to the extension
 */
export function addDownloadedFileToExtension(
    extension: Extension,
    localPath: string,
    originalUrl: string
): void {
    const fileType = determineFileType(localPath, originalUrl);

    // Create a LazyFile for the downloaded resource and add it to the extension
    const absolutePath = path.join(globals.outputDir, extension.mv3_extension_id!, localPath);
    const downloadedFile = new LazyFile(localPath, absolutePath, fileType);

    extension.files.push(downloadedFile);

    logger.debug(
        extension,
        `Added downloaded file to extension: ${localPath} (from ${originalUrl})`
    );
}
