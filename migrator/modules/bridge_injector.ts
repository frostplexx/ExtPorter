import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { FileContentUpdater } from '../utils/file_content_updater';

/**
 * This module injects the ext_bridge.js compatibility layer into Chrome extensions
 * to enable MV2 callback-style APIs to work with MV3 promise-based APIs.
 */
export class BridgeInjector implements MigrationModule {
    private static readonly BRIDGE_FILENAME = 'ext_bridge.js';
    private static readonly CALLBACK_PATTERN = /chrome(\.\w+){2,}\((?:.*?,\s*)?(?:function\s*\(|\([^)]*\)\s*=>|\w+\s*(?:\)|,))/;

    /**
     * Checks if an extension likely uses callback-based Chrome APIs
     * by looking for common callback patterns in JavaScript files.
     */
    private static needsBridge(extension: Extension): boolean {
        // Check if any JS files contain callback patterns
        for (const file of extension.files) {
            if (file.filetype === ExtFileType.JS) {
                try {
                    const content = file.getContent();
                    if (content && BridgeInjector.CALLBACK_PATTERN.test(content)) {
                        return true;
                    }
                } catch (error) {
                    // If we can't read the file, skip it and continue
                    logger.warn(extension, `Failed to read file ${file.path} for bridge detection`, error);
                    continue;
                }
            }
        }
        return false;
    }


    /**
     * Loads the bridge file content from the templates directory.
     */
    private static loadBridgeContent(): string {
        try {
            const bridgePath = path.join(__dirname, '../templates/ext_bridge.js');
            return fs.readFileSync(bridgePath, 'utf8');
        } catch (error) {
            throw new Error(
                `Failed to load bridge file: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Creates a LazyFile instance for the bridge file.
     */
    private static createBridgeFile(): LazyFile {
        const bridgeContent = BridgeInjector.loadBridgeContent();

        // Create a LazyFile-like object for the bridge
        const bridgeFile = Object.create(LazyFile.prototype);
        bridgeFile.path = BridgeInjector.BRIDGE_FILENAME;
        bridgeFile.filetype = ExtFileType.JS;
        bridgeFile._bridgeContent = bridgeContent;

        // Override methods to work with bridge content
        bridgeFile.getContent = () => bridgeContent;
        bridgeFile.getSize = () => Buffer.byteLength(bridgeContent, 'utf8');
        bridgeFile.close = () => {
            /* No-op for in-memory content */
        };
        bridgeFile.getAST = () => {
            // Bridge file doesn't need AST parsing
            return undefined;
        };

        return bridgeFile;
    }

    /**
     * Injects importScripts call into a service worker file.
     */
    private static injectBridgeIntoServiceWorker(extension: Extension, serviceWorkerPath: string): boolean {
        // Find the service worker file in the extension
        const serviceWorkerFile = extension.files.find(file => file.path === serviceWorkerPath);

        if (!serviceWorkerFile) {
            logger.warn(extension, `Service worker file not found: ${serviceWorkerPath}`);
            return false;
        }

        try {
            // Get the current content
            const currentContent = serviceWorkerFile.getContent();

            // Check if the bridge import is already present
            const importStatement = `importScripts('${BridgeInjector.BRIDGE_FILENAME}');`;
            if (currentContent.includes(importStatement)) {
                logger.debug(extension, 'Bridge import already present in service worker');
                return true;
            }

            // Prepend the import statement
            const newContent = `${importStatement}\n${currentContent}`;

            // Update the file content
            FileContentUpdater.updateFileContent(serviceWorkerFile, newContent);

            logger.info(extension, `Bridge injected into service worker: ${serviceWorkerPath}`);
            return true;
        } catch (error) {
            logger.error(
                extension,
                `Error injecting bridge into service worker ${serviceWorkerPath}: ${error instanceof Error ? error.message : String(error)}`,
                {
                    error: error instanceof Error ? {
                        message: error.message,
                        stack: error.stack,
                        name: error.name
                    } : String(error)
                }
            );
            return false;
        }
    }

    /**
     * Injects the bridge file into the manifest's script arrays.
     */
    private static injectBridgeIntoManifest(manifest: any, extension?: Extension): any {

        const updatedManifest = JSON.parse(JSON.stringify(manifest));


        // Inject into background service worker
        if (updatedManifest.background && updatedManifest.background.service_worker) {
            if (extension) {
                const success = BridgeInjector.injectBridgeIntoServiceWorker(
                    extension,
                    updatedManifest.background.service_worker
                );
                if (success) {
                    logger.info(extension, 'Bridge successfully injected into service worker');
                } else {
                    logger.warn(extension, 'Failed to inject bridge into service worker, bridge may not work in background context');
                }
            } else {
                logger.warn(
                    null,
                    'Service worker detected but no extension context provided for bridge injection',
                    {
                        service_worker: updatedManifest.background.service_worker,
                    }
                );
            }
        }

        // Inject into content scripts
        if (updatedManifest.content_scripts && Array.isArray(updatedManifest.content_scripts)) {
            updatedManifest.content_scripts.forEach((contentScript: any) => {
                if (contentScript.js && Array.isArray(contentScript.js)) {
                    if (!contentScript.js.includes(BridgeInjector.BRIDGE_FILENAME)) {
                        contentScript.js.unshift(BridgeInjector.BRIDGE_FILENAME);
                    }
                }
            });
        }

        // Add web_accessible_resources if needed (for content script injection)
        if (updatedManifest.content_scripts && updatedManifest.content_scripts.length > 0) {
            if (!updatedManifest.web_accessible_resources) {
                updatedManifest.web_accessible_resources = [];
            }

            // MV3 format
            if (updatedManifest.manifest_version === 3) {
                const existingResource = updatedManifest.web_accessible_resources.find(
                    (resource: any) =>
                        resource.resources &&
                        resource.resources.includes(BridgeInjector.BRIDGE_FILENAME)
                );

                if (!existingResource) {
                    updatedManifest.web_accessible_resources.push({
                        resources: [BridgeInjector.BRIDGE_FILENAME],
                        matches: ['<all_urls>'],
                    });
                }
            } else {
                // MV2 format (for compatibility during transition)
                if (
                    !updatedManifest.web_accessible_resources.includes(
                        BridgeInjector.BRIDGE_FILENAME
                    )
                ) {
                    updatedManifest.web_accessible_resources.push(BridgeInjector.BRIDGE_FILENAME);
                }
            }
        }

        return updatedManifest;
    }

    /**
     * Main migration method that injects the bridge into extensions that need it.
     */
    public static migrate(extension: Extension): Extension | MigrationError {
        const startTime = Date.now();

        try {

            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Check if the extension needs the bridge
            if (!BridgeInjector.needsBridge(extension)) {
                logger.debug(extension, 'Extension does not need callback bridge');
                return extension;
            }

            // Check if bridge is already injected
            const hasBridge = extension.files.some(
                (file) => file.path === BridgeInjector.BRIDGE_FILENAME
            );
            if (hasBridge) {
                logger.debug(extension, 'Bridge already injected');
                return extension;
            }

            logger.info(extension, 'Injecting callback compatibility bridge');

            // Create bridge file
            const bridgeFile = BridgeInjector.createBridgeFile();

            // Update manifest to include bridge
            const updatedManifest = BridgeInjector.injectBridgeIntoManifest(extension.manifest, extension);

            // Add bridge file to extension files
            const updatedFiles = [...extension.files, bridgeFile];

            const duration = Date.now() - startTime;
            logger.info(extension, 'Bridge injection completed', {
                duration,
                bridgeFile: BridgeInjector.BRIDGE_FILENAME,
            });

            // Return updated extension
            return {
                ...extension,
                manifest: updatedManifest,
                files: updatedFiles,
            };
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(extension, 'Bridge injection failed', {
                error: error instanceof Error ? error.message : String(error),
                duration,
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Helper method for testing - checks if manifest has bridge injected.
     */
    public static hasBridgeInManifest(manifest: any): boolean {
        if (!manifest) {
            return false;
        }

        // Check background scripts
        if (manifest.background && manifest.background.scripts) {
            if (manifest.background.scripts.includes(BridgeInjector.BRIDGE_FILENAME)) {
                return true;
            }
        }

        // Check content scripts
        if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
            return manifest.content_scripts.some(
                (contentScript: any) =>
                    contentScript.js && contentScript.js.includes(BridgeInjector.BRIDGE_FILENAME)
            );
        }

        return false;
    }

    /**
     * Helper method for testing - exposed for unit tests.
     */
    public static testHelpers = {
        needsBridge: BridgeInjector.needsBridge,
        injectBridgeIntoManifest: BridgeInjector.injectBridgeIntoManifest,
        injectBridgeIntoServiceWorker: BridgeInjector.injectBridgeIntoServiceWorker,
        createBridgeFile: BridgeInjector.createBridgeFile,
        loadBridgeContent: BridgeInjector.loadBridgeContent,
        hasBridgeInManifest: BridgeInjector.hasBridgeInManifest,
        BRIDGE_FILENAME: BridgeInjector.BRIDGE_FILENAME,
    };
}
