import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { Tags } from '../../types/tags';
import { DOMDetector } from './dom-detector';
import { OffscreenFileCreator } from './offscreen-files';
import { ServiceWorkerTransformer } from './service-worker-transformer';
import { ManifestUpdater } from './manifest-updater';

/**
 * Unified Offscreen Document Migration Module
 *
 * This module consolidates the functionality of the previous separate modules:
 * - OffscreenDocumentMigrator: Creates offscreen documents for DOM operations
 * - OffscreenMigrator: Handles DOM/window API migration
 * - ServiceWorkerCompat: Fixes service worker compatibility issues
 *
 * In Manifest V3, service workers cannot access the DOM or window APIs.
 * This module detects such usage and:
 * 1. Creates offscreen documents to handle DOM operations
 * 2. Migrates localStorage to chrome.storage.local
 * 3. Replaces window.onload with service worker initialization
 * 4. Migrates DOM-based downloads to chrome.downloads API
 * 5. Injects helper functions for offscreen document communication
 */
export class OffscreenDocumentMigrator implements MigrationModule {
    /**
     * Main migration method that orchestrates all offscreen document migrations.
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        const startTime = Date.now();

        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Only apply to MV3 extensions with service workers
            if (extension.manifest.manifest_version !== 3) {
                return extension;
            }

            if (!extension.manifest.background?.service_worker) {
                return extension;
            }

            // Analyze the extension for DOM/window API usage
            const analysis = DOMDetector.analyzeExtension(extension);

            // Check if any migration is needed
            const needsMigration =
                analysis.needsOffscreen ||
                analysis.needsLocalStorage ||
                analysis.needsWindowOnload ||
                analysis.needsDOMDownload;

            if (!needsMigration) {
                logger.debug(extension, 'No offscreen document migration needed');
                return extension;
            }

            logger.info(extension, 'Offscreen document migration required', {
                needsOffscreen: analysis.needsOffscreen,
                needsLocalStorage: analysis.needsLocalStorage,
                needsWindowOnload: analysis.needsWindowOnload,
                needsDOMDownload: analysis.needsDOMDownload,
                affectedFiles: analysis.affectedFiles,
            });

            // Check if offscreen document files already exist
            const hasOffscreenHTML = extension.files.some(
                (file) => file!.path === OffscreenFileCreator.OFFSCREEN_HTML_FILENAME
            );

            // If offscreen files already exist and no other migrations are needed, return unchanged
            if (
                hasOffscreenHTML &&
                !analysis.needsWindowOnload &&
                !analysis.needsLocalStorage &&
                !analysis.needsDOMDownload
            ) {
                logger.debug(
                    extension,
                    'Offscreen document already exists, no additional changes needed'
                );
                return extension;
            }

            let updatedFiles = [...extension.files];
            let updatedManifest = extension.manifest;

            // Create offscreen document files if DOM access is detected and files don't exist
            if (analysis.needsOffscreen && !hasOffscreenHTML) {
                logger.info(extension, 'Adding offscreen document support for DOM operations');

                const offscreenHTML = OffscreenFileCreator.createOffscreenHTML();
                const offscreenJS = OffscreenFileCreator.createOffscreenJS();

                updatedFiles.push(offscreenHTML, offscreenJS);

                // Inject offscreen helpers into service worker
                const transformedServiceWorker = ServiceWorkerTransformer.injectOffscreenHelpers(
                    extension,
                    extension.manifest.background.service_worker
                );

                if (transformedServiceWorker) {
                    updatedFiles = updatedFiles.map((file) =>
                        file!.path === transformedServiceWorker.path
                            ? transformedServiceWorker
                            : file
                    );
                }
            }

            // Transform service worker for compatibility issues
            if (
                analysis.needsWindowOnload ||
                analysis.needsLocalStorage ||
                analysis.needsDOMDownload
            ) {
                // Create a temporary extension with the updated files to ensure transformations are cumulative
                const tempExtension = {
                    ...extension,
                    files: updatedFiles,
                };

                const transformedServiceWorker = ServiceWorkerTransformer.transformServiceWorker(
                    tempExtension,
                    extension.manifest.background.service_worker,
                    {
                        needsWindowOnload: analysis.needsWindowOnload,
                        needsLocalStorage: analysis.needsLocalStorage,
                        needsDOMDownload: analysis.needsDOMDownload,
                    }
                );

                if (transformedServiceWorker) {
                    updatedFiles = updatedFiles.map((file) =>
                        file!.path === transformedServiceWorker.path

                            ? transformedServiceWorker
                            : file
                    );
                }
            }

            // Update manifest with required permissions
            updatedManifest = ManifestUpdater.updateManifest(extension.manifest, {
                needsOffscreen: analysis.needsOffscreen,
                needsLocalStorage: analysis.needsLocalStorage,
                needsDOMDownload: analysis.needsDOMDownload,
            });

            const duration = Date.now() - startTime;
            logger.info(extension, 'Offscreen document migration completed', {
                duration,
                filesAdded: !hasOffscreenHTML && analysis.needsOffscreen ? 2 : 0,
            });

            // Create updated extension
            const updatedExtension = {
                ...extension,
                manifest: updatedManifest,
                files: updatedFiles,
            };

            // Add tag if offscreen document was added
            if (analysis.needsOffscreen && !hasOffscreenHTML) {
                if (!updatedExtension.tags) {
                    updatedExtension.tags = [];
                }
                const offscreenTag = Tags[Tags.OFFSCREEN_DOCUMENT_ADDED];
                if (!updatedExtension.tags.includes(offscreenTag)) {
                    updatedExtension.tags.push(offscreenTag);
                }
            }


            // NOTE: Do NOT call releaseMemory() or close() here!
            // Files are written asynchronously by WriteQueue and closed by Writer.writeFiles()

            return updatedExtension;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(extension, 'Offscreen document migration failed', {
                error: error instanceof Error ? error.message : String(error),
                duration,
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Helper methods for testing.
     * These expose internal functionality for unit tests.
     */
    public static testHelpers = {
        // File creation
        OFFSCREEN_HTML_FILENAME: OffscreenFileCreator.OFFSCREEN_HTML_FILENAME,
        OFFSCREEN_JS_FILENAME: OffscreenFileCreator.OFFSCREEN_JS_FILENAME,
        createOffscreenHTML: OffscreenFileCreator.createOffscreenHTML.bind(OffscreenFileCreator),
        createOffscreenJS: OffscreenFileCreator.createOffscreenJS.bind(OffscreenFileCreator),

        // Detection
        containsDOMAccess: DOMDetector.containsDOMAccess.bind(DOMDetector),
        needsOffscreenDocument: (extension: Extension) => {
            const analysis = DOMDetector.analyzeExtension(extension);
            return analysis.needsOffscreen;
        },
        DOM_ACCESS_PATTERNS: DOMDetector.patterns.DOM_ACCESS_PATTERNS,

        // Transformation
        injectOffscreenHelpers:
            ServiceWorkerTransformer.injectOffscreenHelpers.bind(ServiceWorkerTransformer),
        replaceWindowOnload:
            ServiceWorkerTransformer.replaceWindowOnload.bind(ServiceWorkerTransformer),
        replaceLocalStorage:
            ServiceWorkerTransformer.replaceLocalStorage.bind(ServiceWorkerTransformer),
        replaceDOMDownloads:
            ServiceWorkerTransformer.replaceDOMDownloads.bind(ServiceWorkerTransformer),
        transformServiceWorker:
            ServiceWorkerTransformer.transformServiceWorker.bind(ServiceWorkerTransformer),

        // Manifest
        updateManifest: ManifestUpdater.updateManifest.bind(ManifestUpdater),

        // Analysis
        analyzeExtension: DOMDetector.analyzeExtension.bind(DOMDetector),
        needsMigration: (extension: Extension) => {
            const analysis = DOMDetector.analyzeExtension(extension);
            return {
                needsFix:
                    analysis.needsOffscreen ||
                    analysis.needsLocalStorage ||
                    analysis.needsWindowOnload ||
                    analysis.needsDOMDownload,
                hasWindowOnload: analysis.needsWindowOnload,
                hasLocalStorage: analysis.needsLocalStorage,
                hasDOMDownload: analysis.needsDOMDownload,
                serviceWorkerPath: extension.manifest?.background?.service_worker || null,
            };
        },
    };
}

// Export for backwards compatibility
export { OffscreenDocumentMigrator as ServiceWorkerCompat };
export { OffscreenDocumentMigrator as OffscreenMigrator };

// Export individual classes for direct use if needed
export { DOMDetector } from './dom-detector';
export { OffscreenFileCreator } from './offscreen-files';
export { ServiceWorkerTransformer } from './service-worker-transformer';
export { ManifestUpdater } from './manifest-updater';
