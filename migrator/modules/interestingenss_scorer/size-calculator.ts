import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';
import { InterestingnessBreakdown } from './scoring-config';

/**
 * Calculates extension size and adds to scores
 */
export function calculateExtensionSize(extension: Extension, scores: InterestingnessBreakdown): void {
    let totalSize = 0;

    for (const file of extension.files) {
        try {
            if (file.filetype === ExtFileType.OTHER) {
                // For binary files, estimate size from buffer
                totalSize += file.getBuffer().length;
            } else {
                // For text files, calculate size from content
                totalSize += Buffer.byteLength(file.getContent(), 'utf8');
            }
        } catch (error) {
            logger.debug(extension, `Error calculating size for file ${file.path}`, { error });
        }
    }

    // Add manifest size
    if (extension.manifest) {
        totalSize += Buffer.byteLength(JSON.stringify(extension.manifest), 'utf8');
    }

    // Convert to KB and calculate score (per 100KB)
    const sizeKB = totalSize / 1024;
    scores.extension_size = Math.floor(sizeKB / 100);
}
