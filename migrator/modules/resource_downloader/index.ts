import { MigrationModule, MigrationError } from '../../types/migration_module';
import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import { findRemoteResources } from './url-extractor';
import { downloadResources } from './downloader';
import { updateReferencesToLocal } from './url-replacer';
import { addDownloadedFileToExtension } from './file-manager';

// Re-export types for backward compatibility
export { RemoteResource, DownloadResult } from './types';

/**
 * Migration module that downloads remote resources and localizes them
 */
export class ResourceDownloader extends MigrationModule {
    public static migrate(extension: Extension): Extension | MigrationError {
        try {

            // Check for null/invalid extension or manifest
            if (!extension || !extension.manifest) {
                throw new Error('Extension or manifest is null/undefined');
            }

            logger.info(extension, 'Starting remote resource download');



            const result = processExtension(extension);




            logger.info(extension, `Remote resource download completed`);
            return result;
        } catch (error) {
            logger.error(extension, 'Failed to download remote resources', { error });
            return new MigrationError(extension, error);
        }
    }
}

/**
 * Main processing function for downloading and localizing resources
 */
export function processExtension(extension: Extension): Extension {
    const remoteResources = findRemoteResources(extension);

    if (remoteResources.length === 0) {
        logger.info(extension, 'No remote resources found to download');
        return extension;
    }

    logger.info(
        extension,
        `Found ${remoteResources.length} remote resources to download: ${remoteResources.map((r) => r.url).join(', ')}`
    );

    // Create a copy of the extension to avoid mutating the original
    const extensionCopy: Extension = {
        id: extension.id,
        name: extension.name,
        mv3_extension_id: extension.mv3_extension_id,
        manifest_v2_path: extension.manifest_v2_path,
        manifest: { ...extension.manifest },
        files: [...extension.files], // Shallow copy of files array
    };

    const downloadResults = downloadResources(extensionCopy, remoteResources);

    // Add downloaded files to extension
    downloadResults.forEach((result) => {
        if (result.success && result.localPath) {
            addDownloadedFileToExtension(extensionCopy, result.localPath, result.url);
        }
    });

    const updatedExtension = updateReferencesToLocal(extensionCopy, downloadResults);

    const successCount = downloadResults.filter((r) => r.success).length;
    logger.info(extension, `Downloaded ${successCount}/${downloadResults.length} remote resources`);

    return updatedExtension;
}
