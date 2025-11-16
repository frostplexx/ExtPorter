import { logger } from '../../utils/logger';

/**
 * Updates manifest files to include necessary permissions for offscreen documents
 * and other service worker compatibility features.
 */
export class ManifestUpdater {
    /**
     * Updates the manifest to add required permissions based on what features are used.
     */
    public static updateManifest(
        manifest: any,
        options: {
            needsOffscreen?: boolean;
            needsLocalStorage?: boolean;
            needsDOMDownload?: boolean;
        }
    ): any {
        const updatedManifest = JSON.parse(JSON.stringify(manifest));

        // Initialize permissions array if it doesn't exist
        if (!updatedManifest.permissions) {
            updatedManifest.permissions = [];
        }

        // Add offscreen permission if offscreen document is needed
        if (options.needsOffscreen && !updatedManifest.permissions.includes('offscreen')) {
            updatedManifest.permissions.push('offscreen');
            logger.debug(null, 'Added offscreen permission to manifest');
        }

        // Add storage permission for localStorage migration
        if (options.needsLocalStorage && !updatedManifest.permissions.includes('storage')) {
            updatedManifest.permissions.push('storage');
            logger.debug(null, 'Added storage permission for localStorage migration');
        }

        // Add downloads permission for DOM download migration
        if (options.needsDOMDownload && !updatedManifest.permissions.includes('downloads')) {
            updatedManifest.permissions.push('downloads');
            logger.debug(null, 'Added downloads permission for file download migration');
        }

        return updatedManifest;
    }
}
