import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { Tags } from '../../types/tags';
import { BridgeDetector } from './bridge_detector';
import { createBridgeFile, loadBridgeContent } from './bridge_file_creator';
import { injectBridgeIntoManifest } from './manifest_injector';
import { ServiceWorkerInjector } from './service_worker_injector';
import { HtmlInjector } from './html_injector';
import { extensionUtils } from '../../utils/extension_utils';

/**
 * This module injects the ext_bridge.js compatibility layer into Chrome extensions
 * to enable MV2 callback-style APIs to work with MV3 promise-based APIs.
 */
export class BridgeInjector implements MigrationModule {
    private static readonly BRIDGE_FILENAME = 'ext_bridge.js';

    /**
     * Main migration method that injects the bridge into extensions that need it.
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Check if the extension needs the bridge
            if (!BridgeDetector.needsBridge(extension)) {
                logger.debug(extension, 'Extension does not need callback bridge');
                return extension;
            }

            // Check if bridge is already injected
            const hasBridge = extension.files.some(
                (file) => {
                    if (file == null){
                        logger.error(extension, "File is null");
                        return
                    }

                    return file.path === BridgeInjector.BRIDGE_FILENAME
                }
            );
            if (hasBridge) {
                logger.debug(extension, 'Bridge already injected');
                return extension;
            }

            logger.info(extension, 'Injecting callback compatibility bridge');

            // Create bridge file
            const bridgeFile = createBridgeFile(BridgeInjector.BRIDGE_FILENAME);

            // Update manifest to include bridge
            const { updatedManifest } = injectBridgeIntoManifest(
                extension.manifest,
                BridgeInjector.BRIDGE_FILENAME,
                extension
            );

            // Add bridge file to extension files
            const updatedFiles = [...extension.files, bridgeFile];

            // Create updated extension
            let updatedExtension = {
                ...extension,
                manifest: updatedManifest,
                files: updatedFiles,
            };

            updatedExtension = extensionUtils.addTag(updatedExtension, Tags.BRIDGE_INJECTED);


            extension.files.forEach(file => {
                if (file) {
                    file.releaseMemory();  // Clear cached content
                    file.close();          // Close file descriptors
                }
            });

            return updatedExtension;
        } catch (error) {
            logger.error(extension, 'Bridge injection failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Helper method for testing - checks if manifest has bridge injected.
     * Note: This only checks manifest-declared scripts. HTML page injections
     * (options_page, popups, etc.) require checking the actual HTML file contents,
     * which this method does not do.
     */
    public static hasBridgeInManifest(manifest: any): boolean {
        return BridgeDetector.hasBridgeInManifest(manifest, BridgeInjector.BRIDGE_FILENAME);
    }

    /**
     * Helper method to check if an HTML file has the bridge injected.
     * This checks the actual file content, not just the manifest.
     */
    public static hasBridgeInHTML(extension: Extension, htmlPath: string): boolean {
        return BridgeDetector.hasBridgeInHTML(extension, htmlPath, BridgeInjector.BRIDGE_FILENAME);
    }

    /**
     * Helper method for testing - exposed for unit tests.
     */
    public static testHelpers = {
        needsBridge: BridgeDetector.needsBridge,
        injectBridgeIntoManifest: (manifest: any, extension?: Extension) =>
            injectBridgeIntoManifest(manifest, BridgeInjector.BRIDGE_FILENAME, extension)
                .updatedManifest,
        injectBridgeIntoServiceWorker: (extension: Extension, serviceWorkerPath: string) =>
            ServiceWorkerInjector.injectBridgeIntoServiceWorker(
                extension,
                serviceWorkerPath,
                BridgeInjector.BRIDGE_FILENAME
            ),
        injectBridgeIntoHTML: (extension: Extension, htmlPath: string) =>
            HtmlInjector.injectBridgeIntoHTML(extension, htmlPath, BridgeInjector.BRIDGE_FILENAME),
        createBridgeFile: () => createBridgeFile(BridgeInjector.BRIDGE_FILENAME),
        loadBridgeContent: loadBridgeContent,
        hasBridgeInManifest: BridgeInjector.hasBridgeInManifest,
        hasBridgeInHTML: BridgeInjector.hasBridgeInHTML,
        BRIDGE_FILENAME: BridgeInjector.BRIDGE_FILENAME,
    };
}
