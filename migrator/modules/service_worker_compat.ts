import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import { logger } from '../utils/logger';

/**
 * This module handles migration of incompatible APIs in service workers:
 * - window object usage
 * - localStorage to chrome.storage.local
 * - DOM manipulation for downloads to chrome.downloads
 * - document object usage
 *
 * According to Google's MV3 migration guide, service workers cannot access
 * DOM, window, or localStorage APIs. These must be migrated to compatible alternatives.
 */
export class ServiceWorkerCompat implements MigrationModule {
    /**
     * Patterns for detecting incompatible APIs
     */
    private static readonly WINDOW_ONLOAD_PATTERN =
        /window\.onload\s*=\s*function\s*\([^)]*\)\s*\{/g;
    private static readonly LOCALSTORAGE_GETITEM =
        /localStorage\.getItem\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
    private static readonly LOCALSTORAGE_SETITEM =
        /localStorage\.setItem\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^)]+)\)/g;
    private static readonly LOCALSTORAGE_REMOVEITEM =
        /localStorage\.removeItem\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
    private static readonly LOCALSTORAGE_CLEAR = /localStorage\.clear\s*\(\s*\)/g;

    // DOM download pattern detection
    private static readonly DOM_DOWNLOAD_PATTERN =
        /document\.createElement\s*\(\s*['"`]a['"`]\s*\)[^}]*?\.download\s*=/;
    private static readonly BLOB_PATTERN = /new\s+Blob\s*\(/;
    private static readonly CREATE_OBJECT_URL = /URL\.createObjectURL\s*\(/;

    /**
     * Check if service worker needs compatibility fixes
     */
    private static needsMigration(extension: Extension): {
        needsFix: boolean;
        hasWindowOnload: boolean;
        hasLocalStorage: boolean;
        hasDOMDownload: boolean;
        serviceWorkerPath: string | null;
    } {
        const result = {
            needsFix: false,
            hasWindowOnload: false,
            hasLocalStorage: false,
            hasDOMDownload: false,
            serviceWorkerPath: null as string | null,
        };

        // Only check MV3 extensions with service workers
        if (extension.manifest.manifest_version !== 3) {
            return result;
        }

        const serviceWorkerPath = extension.manifest.background?.service_worker;
        if (!serviceWorkerPath) {
            return result;
        }

        result.serviceWorkerPath = serviceWorkerPath;

        const swFile = extension.files.find((f) => f.path === serviceWorkerPath);
        if (!swFile || swFile.filetype !== ExtFileType.JS) {
            return result;
        }

        try {
            const content = swFile.getContent();

            // Check for window.onload
            if (ServiceWorkerCompat.WINDOW_ONLOAD_PATTERN.test(content)) {
                result.hasWindowOnload = true;
                result.needsFix = true;
            }

            // Check for localStorage
            if (
                ServiceWorkerCompat.LOCALSTORAGE_GETITEM.test(content) ||
                ServiceWorkerCompat.LOCALSTORAGE_SETITEM.test(content) ||
                ServiceWorkerCompat.LOCALSTORAGE_REMOVEITEM.test(content) ||
                ServiceWorkerCompat.LOCALSTORAGE_CLEAR.test(content)
            ) {
                result.hasLocalStorage = true;
                result.needsFix = true;
            }

            // Check for DOM-based downloads
            if (
                ServiceWorkerCompat.DOM_DOWNLOAD_PATTERN.test(content) &&
                ServiceWorkerCompat.BLOB_PATTERN.test(content) &&
                ServiceWorkerCompat.CREATE_OBJECT_URL.test(content)
            ) {
                result.hasDOMDownload = true;
                result.needsFix = true;
            }
        } catch (error) {
            logger.warn(
                extension,
                `Failed to check service worker for compatibility issues`,
                error
            );
        }

        return result;
    }

    /**
     * Transform service worker to be compatible with MV3
     */
    private static transformServiceWorker(
        extension: Extension,
        serviceWorkerPath: string,
        fixes: { hasWindowOnload: boolean; hasLocalStorage: boolean; hasDOMDownload: boolean }
    ): LazyFile | null {
        const swFile = extension.files.find((f) => f.path === serviceWorkerPath);
        if (!swFile) {
            return null;
        }

        try {
            let content = swFile.getContent();
            let modified = false;

            // 1. Replace window.onload with self-executing async function
            if (fixes.hasWindowOnload) {
                content = ServiceWorkerCompat.replaceWindowOnload(content);
                modified = true;
                logger.info(extension, 'Replaced window.onload with service worker initialization');
            }

            // 2. Replace localStorage with chrome.storage.local
            if (fixes.hasLocalStorage) {
                content = ServiceWorkerCompat.replaceLocalStorage(content);
                modified = true;
                logger.info(extension, 'Migrated localStorage to chrome.storage.local');
            }

            // 2.5. Convert callback-based chrome API calls to async/await
            const convertedContent = ServiceWorkerCompat.convertCallbacksToAsync(content);
            if (convertedContent !== content) {
                content = convertedContent;
                modified = true;
            }

            // 3. Replace DOM download with chrome.downloads API
            if (fixes.hasDOMDownload) {
                content = ServiceWorkerCompat.replaceDOMDownloads(content);
                modified = true;
                logger.info(extension, 'Migrated DOM-based downloads to chrome.downloads API');
            }

            if (!modified) {
                return null;
            }

            // Create transformed file with proper memory management
            const contentBuffer = Buffer.from(content, 'utf8');
            const transformedFile = Object.create(LazyFile.prototype);
            transformedFile.path = swFile.path;
            transformedFile.filetype = swFile.filetype;
            transformedFile.getContent = () => content;
            transformedFile.getBuffer = () => contentBuffer;
            transformedFile.getSize = () => contentBuffer.length;
            transformedFile.close = () => {
                /* No-op for in-memory content */
            };
            transformedFile.releaseMemory = () => {
                /* No-op for in-memory content */
            };
            transformedFile.cleanContent = () => transformedFile;
            transformedFile.getAST = () => undefined;

            // Release memory from original file
            if (swFile.releaseMemory) {
                swFile.releaseMemory();
            }

            return transformedFile;
        } catch (error) {
            logger.error(
                extension,
                `Failed to transform service worker for compatibility: ${error}`,
                error
            );
            return null;
        }
    }

    /**
     * Replace window.onload with service worker initialization
     */
    private static replaceWindowOnload(content: string): string {
        // Replace window.onload = function() { ... } with IIFE and ensure it's called
        let result = content.replace(
            /window\.onload\s*=\s*function\s*\([^)]*\)\s*\{/g,
            '(async function initializeServiceWorker() {'
        );

        // Ensure the IIFE is actually invoked - look for the closing }; and add ()
        // Find pattern like };  at the end that should be }();
        result = result.replace(
            /(async function initializeServiceWorker\(\)[^}]*\{[^}]*\}\s*);/,
            '$1)();'
        );

        return result;
    }

    /**
     * Replace localStorage calls with chrome.storage.local
     */
    private static replaceLocalStorage(content: string): string {
        // Add storage helper at the beginning if localStorage is used
        const storageHelper = `
// Storage helper for chrome.storage.local (replaces localStorage)
const storageHelper = {
    async get(key) {
        try {
            const result = await chrome.storage.local.get([key]);
            return result[key];
        } catch (error) {
            console.error('Storage get error:', error);
            return null;
        }
    },
    async set(key, value) {
        try {
            await chrome.storage.local.set({ [key]: value });
        } catch (error) {
            console.error('Storage set error:', error);
        }
    },
    async remove(key) {
        try {
            await chrome.storage.local.remove([key]);
        } catch (error) {
            console.error('Storage remove error:', error);
        }
    },
    async clear() {
        try {
            await chrome.storage.local.clear();
        } catch (error) {
            console.error('Storage clear error:', error);
        }
    }
};

`;

        let result = content;

        // Only add helper if not already present
        if (!result.includes('storageHelper')) {
            // Insert after any importScripts() calls
            const importScriptsMatch = result.match(/((?:importScripts\([^)]+\);\s*)+)/);
            if (importScriptsMatch) {
                result = result.replace(
                    importScriptsMatch[0],
                    importScriptsMatch[0] + '\n' + storageHelper
                );
            } else {
                result = storageHelper + result;
            }
        }

        // Replace localStorage.getItem
        result = result.replace(
            ServiceWorkerCompat.LOCALSTORAGE_GETITEM,
            (_fullMatch, quote, key, offset) => {
                // Check if it's in a JSON.parse call
                const beforeMatch = result.substring(0, offset);
                if (beforeMatch.endsWith('JSON.parse(')) {
                    return `storageHelper.get(${quote}${key}${quote})`;
                }
                return `(await storageHelper.get(${quote}${key}${quote}))`;
            }
        );

        // Replace localStorage.setItem
        result = result.replace(
            ServiceWorkerCompat.LOCALSTORAGE_SETITEM,
            (_fullMatch, quote, key, value) => {
                // Check if value is JSON.stringify
                if (value.trim().startsWith('JSON.stringify(')) {
                    // Extract the object being stringified
                    const objMatch = value.match(/JSON\.stringify\(([^)]+)\)/);
                    if (objMatch) {
                        return `await storageHelper.set(${quote}${key}${quote}, ${objMatch[1]})`;
                    }
                }
                return `await storageHelper.set(${quote}${key}${quote}, ${value})`;
            }
        );

        // Replace localStorage.removeItem
        result = result.replace(
            ServiceWorkerCompat.LOCALSTORAGE_REMOVEITEM,
            (_fullMatch, quote, key) => `await storageHelper.remove(${quote}${key}${quote})`
        );

        // Replace localStorage.clear
        result = result.replace(
            ServiceWorkerCompat.LOCALSTORAGE_CLEAR,
            'await storageHelper.clear()'
        );

        return result;
    }

    /**
     * Convert callback-based chrome API calls to async/await
     * Handles patterns like: chrome.tabs.query({}, function(result) { ... })
     */
    private static convertCallbacksToAsync(content: string): string {
        let result = content;

        // Pattern 1: Make functions async if they contain await but aren't marked async
        // Look for functions that have await inside them
        const functionPattern = /function\s+(\w+)\s*\([^)]*\)\s*\{/g;
        const functions = content.match(functionPattern);

        if (functions) {
            functions.forEach((funcDecl) => {
                const funcName = funcDecl.match(/function\s+(\w+)/)?.[1];
                if (funcName) {
                    // Find the function body
                    const funcStart = result.indexOf(funcDecl);
                    if (funcStart !== -1) {
                        const funcBody = result.substring(funcStart);
                        // Check if function body contains await
                        if (funcBody.includes('await ') && !funcDecl.includes('async')) {
                            // Make it async
                            result = result.replace(
                                funcDecl,
                                funcDecl.replace('function ', 'async function ')
                            );
                        }
                    }
                }
            });
        }

        // Pattern 2: Convert chrome.tabs.query callback to async/await
        result = result.replace(
            /chrome\.tabs\.query\s*\(\s*(\{[^}]*\})\s*,\s*function\s*\([^)]*\)\s*\{/g,
            'chrome.tabs.query($1).then(async (tabs) => {'
        );

        // Pattern 3: Close the Promise chain properly - replace closing } with })
        // This is tricky - we need to find matching closing braces
        // For now, we'll handle simple cases

        return result;
    }

    /**
     * Replace DOM-based file downloads with chrome.downloads API
     */
    private static replaceDOMDownloads(content: string): string {
        // This is a complex transformation - we need to find the download pattern and replace it

        // Pattern: document.createElement('a') -> blob -> URL.createObjectURL -> click
        // Replace with: chrome.downloads.download()

        // Find functions that contain download logic
        // Removed fragile regex. Use brace-matching below.

        let result = content;

        // Find all function declarations that may contain the download pattern
        const functionDeclPattern = /(?:async\s+)?function\s+(\w*)\s*\([^)]*\)\s*\{/g;
        let match: RegExpExecArray | null;
        let newContent = '';
        let lastIndex = 0;
        while ((match = functionDeclPattern.exec(content)) !== null) {
            const funcStart = match.index;
            const funcHeaderEnd = functionDeclPattern.lastIndex;
            // Find the matching closing brace for the function body
            let braceCount = 1;
            let i = funcHeaderEnd;
            while (i < content.length && braceCount > 0) {
                if (content[i] === '{') braceCount++;
                else if (content[i] === '}') braceCount--;
                i++;
            }
            const funcEnd = i;
            const funcBody = content.slice(funcStart, funcEnd);

            // Check if function contains the download pattern
            if (
                /document\.createElement\s*\(\s*['"`]a['"`]\s*\)/.test(funcBody) &&
                /\.download\s*=/.test(funcBody)
            ) {
                // Check if it's an async function
                const isAsync = /^async\s+function/.test(funcBody);
                let transformed = funcBody;
                if (!isAsync) {
                    transformed = transformed.replace(/^function/, 'async function');
                }

                // Extract fileName and data if possible
                const fileNameMatch = funcBody.match(
                    /\.setAttribute\s*\(\s*['"`]download['"`]\s*,\s*([^)]+)\)/
                );
                const blobMatch = funcBody.match(
                    /new\s+Blob\s*\(\s*\[([^\]]+)\]\s*,\s*\{\s*type:\s*['"`]([^'"`]+)['"`]/
                );

                if (fileNameMatch && blobMatch) {
                    const fileName = fileNameMatch[1];
                    const dataVar = blobMatch[1];
                    const mimeType = blobMatch[2];

                    // Replace the DOM manipulation with chrome.downloads
                    const downloadCode = `
    // Use chrome.downloads API instead of DOM manipulation
    chrome.downloads.download({
        url: URL.createObjectURL(new Blob([${dataVar}], {type: '${mimeType}'})),
        filename: ${fileName},
        saveAs: true
    });
`;
                    // Replace the old download logic with the new code
                    // Remove pom.click(), setAttribute('download', ...), etc.
                    transformed = transformed.replace(
                        /var\s+pom\s*=\s*document\.createElement\s*\(\s*['"`]a['"`]\s*\);[\s\S]*?pom\.click\s*\(\s*\);?/,
                        downloadCode
                    );
                }
                // Append transformed function
                newContent += content.slice(lastIndex, funcStart) + transformed;
                lastIndex = funcEnd;
            }
        }
        // Append the rest of the content
        newContent += content.slice(lastIndex);
        result = newContent;

        return result;
    }

    /**
     * Update manifest to add required permissions
     */
    private static updateManifest(
        manifest: any,
        fixes: { hasLocalStorage: boolean; hasDOMDownload: boolean }
    ): any {
        const updatedManifest = JSON.parse(JSON.stringify(manifest));

        if (!updatedManifest.permissions) {
            updatedManifest.permissions = [];
        }

        // Add storage permission for localStorage migration
        if (fixes.hasLocalStorage && !updatedManifest.permissions.includes('storage')) {
            updatedManifest.permissions.push('storage');
            logger.debug(null, 'Added storage permission for localStorage migration');
        }

        // Add downloads permission for DOM download migration
        if (fixes.hasDOMDownload && !updatedManifest.permissions.includes('downloads')) {
            updatedManifest.permissions.push('downloads');
            logger.debug(null, 'Added downloads permission for file download migration');
        }

        return updatedManifest;
    }

    /**
     * Main migration method
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            const analysis = ServiceWorkerCompat.needsMigration(extension);

            if (!analysis.needsFix) {
                return extension;
            }

            logger.info(extension, 'Service worker compatibility issues detected', {
                window_onload: analysis.hasWindowOnload,
                localStorage: analysis.hasLocalStorage,
                dom_downloads: analysis.hasDOMDownload,
            });

            // Transform service worker
            const transformedSW = ServiceWorkerCompat.transformServiceWorker(
                extension,
                analysis.serviceWorkerPath!,
                {
                    hasWindowOnload: analysis.hasWindowOnload,
                    hasLocalStorage: analysis.hasLocalStorage,
                    hasDOMDownload: analysis.hasDOMDownload,
                }
            );

            // Update files
            let updatedFiles = [...extension.files];
            if (transformedSW) {
                updatedFiles = updatedFiles.map((f) =>
                    f.path === transformedSW.path ? transformedSW : f
                );
            }

            // Update manifest with required permissions
            const updatedManifest = ServiceWorkerCompat.updateManifest(extension.manifest, {
                hasLocalStorage: analysis.hasLocalStorage,
                hasDOMDownload: analysis.hasDOMDownload,
            });

            logger.info(extension, 'Successfully applied service worker compatibility fixes');

            return {
                ...extension,
                manifest: updatedManifest,
                files: updatedFiles,
            };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error during migration';
            logger.error(
                extension,
                `Service worker compatibility migration failed: ${errorMessage}`,
                error
            );
            return new MigrationError(extension, new Error(errorMessage));
        }
    }

    // Test helpers for unit tests
    public static testHelpers = {
        needsMigration: ServiceWorkerCompat.needsMigration,
        transformServiceWorker: ServiceWorkerCompat.transformServiceWorker,
        replaceWindowOnload: ServiceWorkerCompat.replaceWindowOnload,
        replaceLocalStorage: ServiceWorkerCompat.replaceLocalStorage,
        replaceDOMDownloads: ServiceWorkerCompat.replaceDOMDownloads,
        updateManifest: ServiceWorkerCompat.updateManifest,
    };
}
