import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { Database } from '../features/database/db_manager';
import { Tags } from '../types/tags';
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

            // Prepend import statement
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
     * Injects bridge script tag into an HTML file.
     */
    private static injectBridgeIntoHTML(extension: Extension, htmlPath: string): boolean {
        const htmlFile = extension.files.find(file => file.path === htmlPath);

        if (!htmlFile) {
            logger.warn(extension, `HTML file not found: ${htmlPath}`);
            return false;
        }

        try {
            const content = htmlFile.getContent();

            // Calculate the correct relative path from the HTML file to the bridge file
            // The bridge file is always in the root, so we need to go up directories
            const htmlDir = path.dirname(htmlPath);
            const relativePath = htmlDir && htmlDir !== '.'
                ? path.posix.join(...htmlDir.split(path.sep).map(() => '..'), BridgeInjector.BRIDGE_FILENAME)
                : BridgeInjector.BRIDGE_FILENAME;

            const scriptTag = `<script src="${relativePath}"></script>`;

            // Check if already injected (check for both the filename and the script tag)
            if (content.includes(BridgeInjector.BRIDGE_FILENAME)) {
                logger.debug(extension, `Bridge already in ${htmlPath}`);
                return true;
            }

            // Inject before first existing script or before </head> or before </body>
            let newContent: string;
            if (content.includes('<script')) {
                // Inject before first script
                newContent = content.replace(/<script/, `${scriptTag}\n    <script`);
            } else if (content.includes('</head>')) {
                newContent = content.replace('</head>', `    ${scriptTag}\n</head>`);
            } else if (content.includes('</body>')) {
                newContent = content.replace('</body>', `    ${scriptTag}\n</body>`);
            } else {
                logger.warn(extension, `Could not find injection point in ${htmlPath}`);
                return false;
            }

            FileContentUpdater.updateFileContent(htmlFile, newContent);
            logger.info(extension, `Bridge injected into HTML: ${htmlPath}`);
            return true;
        } catch (error) {
            logger.error(
                extension,
                `Error injecting bridge into ${htmlPath}: ${error instanceof Error ? error.message : String(error)}`,
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

        // Inject into HTML pages
        if (extension) {
            // Inject into options page
            if (updatedManifest.options_page) {
                BridgeInjector.injectBridgeIntoHTML(extension, updatedManifest.options_page);
            }

            // Inject into options_ui page
            if (updatedManifest.options_ui?.page) {
                BridgeInjector.injectBridgeIntoHTML(extension, updatedManifest.options_ui.page);
            }

            // Inject into action/browser_action/page_action popups
            const popupKeys = ['action', 'browser_action', 'page_action'];
            for (const key of popupKeys) {
                if (updatedManifest[key]?.default_popup) {
                    BridgeInjector.injectBridgeIntoHTML(extension, updatedManifest[key].default_popup);
                }
            }

            // Inject into devtools page
            if (updatedManifest.devtools_page) {
                BridgeInjector.injectBridgeIntoHTML(extension, updatedManifest.devtools_page);
            }

            // Inject into sidebar action (Firefox)
            if (updatedManifest.sidebar_action?.default_panel) {
                BridgeInjector.injectBridgeIntoHTML(extension, updatedManifest.sidebar_action.default_panel);
            }
        }

        return updatedManifest;
    }

    /**
     * Main migration method that injects the bridge into extensions that need it.
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
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

            // Add BRIDGE_INJECTED tag
            await Database.shared.extensionAppendTag(extension, Tags.BRIDGE_INJECTED);

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
     * Note: This only checks manifest-declared scripts. HTML page injections
     * (options_page, popups, etc.) require checking the actual HTML file contents,
     * which this method does not do.
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
     * Helper method to check if an HTML file has the bridge injected.
     * This checks the actual file content, not just the manifest.
     */
    public static hasBridgeInHTML(extension: Extension, htmlPath: string): boolean {
        const htmlFile = extension.files.find(file => file.path === htmlPath);

        if (!htmlFile) {
            return false;
        }

        try {
            const content = htmlFile.getContent();
            // Check if the bridge filename appears anywhere in the content
            // (could be with or without relative path)
            return content.includes(BridgeInjector.BRIDGE_FILENAME);
        } catch (error) {
            logger.error(extension, error as any)
            return false;
        }
    }

    /**
     * Helper method for testing - exposed for unit tests.
     */
    public static testHelpers = {
        needsBridge: BridgeInjector.needsBridge,
        injectBridgeIntoManifest: BridgeInjector.injectBridgeIntoManifest,
        injectBridgeIntoServiceWorker: BridgeInjector.injectBridgeIntoServiceWorker,
        injectBridgeIntoHTML: BridgeInjector.injectBridgeIntoHTML,
        createBridgeFile: BridgeInjector.createBridgeFile,
        loadBridgeContent: BridgeInjector.loadBridgeContent,
        hasBridgeInManifest: BridgeInjector.hasBridgeInManifest,
        hasBridgeInHTML: BridgeInjector.hasBridgeInHTML,
        BRIDGE_FILENAME: BridgeInjector.BRIDGE_FILENAME,
    };
}
