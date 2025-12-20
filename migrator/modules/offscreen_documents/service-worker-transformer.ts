import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { logger } from '../../utils/logger';
import { OffscreenFileCreator } from './offscreen-files';

/**
 * Transforms service worker code to be compatible with MV3 and offscreen documents.
 * Handles localStorage migration, window.onload replacement, DOM download fixes, etc.
 */
export class ServiceWorkerTransformer {
    /**
     * Adds helper code to the service worker for managing offscreen documents.
     */
    public static injectOffscreenHelpers(
        extension: Extension,
        serviceWorkerPath: string
    ): LazyFile | null {
        const serviceWorkerFile = extension.files.find((file) => file.path === serviceWorkerPath);

        if (!serviceWorkerFile) {
            logger.warn(extension, `Service worker file not found: ${serviceWorkerPath}`);
            return null;
        }

        try {
            const currentContent = serviceWorkerFile.getContent();

            // Check if helpers are already present
            if (currentContent.includes('createOffscreenDocument')) {
                logger.debug(extension, 'Offscreen helpers already present in service worker');
                return null;
            }

            const helperCode = `
// Offscreen Document Helper Functions
// These helpers manage the offscreen document lifecycle and communication

let offscreenDocumentCreating = null;

/**
 * Creates an offscreen document if it doesn't exist
 */
async function ensureOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT']
    });

    if (existingContexts.length > 0) {
        return;
    }

    if (offscreenDocumentCreating) {
        await offscreenDocumentCreating;
        return;
    }

    offscreenDocumentCreating = chrome.offscreen.createDocument({
        url: '${OffscreenFileCreator.OFFSCREEN_HTML_FILENAME}',
        reasons: ['DOM_SCRAPING'], // Adjust reasons as needed
        justification: 'Performing DOM operations that are not available in service workers'
    });

    await offscreenDocumentCreating;
    offscreenDocumentCreating = null;
}

/**
 * Sends a message to the offscreen document
 */
async function sendToOffscreen(type, data) {
    await ensureOffscreenDocument();
    
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
            {
                target: 'offscreen',
                type: type,
                data: data
            },
            response => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else if (response && response.success) {
                    resolve(response.result);
                } else {
                    reject(new Error(response?.error || 'Unknown error'));
                }
            }
        );
    });
}

`;

            const newContent = `${helperCode}\n${currentContent}`;

            logger.info(
                extension,
                `Injected offscreen helpers into service worker: ${serviceWorkerPath}`
            );

            return ServiceWorkerTransformer.createTransformedFile(serviceWorkerFile, newContent);
        } catch (error) {
            logger.error(
                extension,
                `Error injecting offscreen helpers into service worker ${serviceWorkerPath}`,
                error
            );
            return null;
        }
    }

    /**
     * Replace window.onload with service worker initialization
     */
    public static replaceWindowOnload(content: string): string {
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
    public static replaceLocalStorage(content: string): string {
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
            /localStorage\.getItem\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
            (_fullMatch, quote, key) => {
                // Check if it's in a JSON.parse call
                const beforeMatch = result.substring(0, result.indexOf(_fullMatch));
                if (beforeMatch.endsWith('JSON.parse(')) {
                    return `storageHelper.get(${quote}${key}${quote})`;
                }
                return `(await storageHelper.get(${quote}${key}${quote}))`;
            }
        );

        // Replace localStorage.setItem - need better handling for nested parentheses
        // First, let's handle the JSON.stringify case specifically
        result = result.replace(
            /localStorage\.setItem\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*JSON\.stringify\(([^)]+)\)\s*\)/g,
            (_fullMatch, quote, key, obj) => {
                return `await storageHelper.set(${quote}${key}${quote}, ${obj})`;
            }
        );

        // Then handle regular localStorage.setItem calls (that weren't JSON.stringify)
        result = result.replace(
            /localStorage\.setItem\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^)]+)\)/g,
            (_fullMatch, quote, key, value) => {
                return `await storageHelper.set(${quote}${key}${quote}, ${value})`;
            }
        );

        // Replace localStorage.removeItem
        result = result.replace(
            /localStorage\.removeItem\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
            (_fullMatch, quote, key) => `await storageHelper.remove(${quote}${key}${quote})`
        );

        // Replace localStorage.clear
        result = result.replace(/localStorage\.clear\s*\(\s*\)/g, 'await storageHelper.clear()');

        return result;
    }

    /**
     * Convert callback-based chrome API calls to async/await
     * Handles patterns like: chrome.tabs.query({}, function(result) { ... })
     */
    public static convertCallbacksToAsync(content: string): string {
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

        return result;
    }

    /**
     * Replace DOM-based file downloads with chrome.downloads API
     */
    public static replaceDOMDownloads(content: string): string {
        // This is a complex transformation - we need to find the download pattern and replace it

        // Pattern: document.createElement('a') -> blob -> URL.createObjectURL -> click
        // Replace with: chrome.downloads.download()

        // Find functions that contain download logic
        // Match functions with either .download = or .setAttribute('download', ...)
        const downloadFunctionPattern =
            /function\s+(\w*)\s*\([^)]*\)\s*\{[\s\S]*?document\.createElement\s*\(\s*['"`]a['"`]\s*\)[\s\S]*?(?:\.download\s*=|\.setAttribute\s*\(\s*['"`]download['"`])[\s\S]*?\}/g;

        let result = content;

        result = result.replace(downloadFunctionPattern, (match) => {
            // Check if it's an async function
            const isAsync = /^async\s+function/.test(match);
            if (!isAsync) {
                // Make it async
                match = match.replace(/^function/, 'async function');
            }

            // Replace DOM download code with chrome.downloads
            let transformed = match;

            // Look for the file download pattern
            // var pom = document.createElement('a');
            // var blob = new Blob([data], {type: 'mime/type'});
            // var url = URL.createObjectURL(blob);
            // pom.href = url;
            // pom.setAttribute('download', fileName);
            // pom.click();

            // Extract fileName and data if possible
            // Handle both .setAttribute('download', fileName) and .download = fileName
            const setAttrMatch = match.match(
                /\.setAttribute\s*\(\s*['"`]download['"`]\s*,\s*([^)]+)\)/
            );
            const directAssignMatch = match.match(/\.download\s*=\s*['"`]([^'"`]+)['"`]/);

            const blobMatch = match.match(
                /new\s+Blob\s*\(\s*\[([^\]]+)\]\s*,\s*\{\s*type:\s*['"`]([^'"`]+)['"`]/
            );

            if ((setAttrMatch || directAssignMatch) && blobMatch) {
                // Get filename - for setAttribute it's a variable, for direct assign it's a string
                const fileName = setAttrMatch ? setAttrMatch[1] : `'${directAssignMatch![1]}'`;
                const dataVar = blobMatch[1];
                const mimeType = blobMatch[2];

                // Replace the DOM manipulation with chrome.downloads
                const downloadCode = `
    // Use chrome.downloads API instead of DOM manipulation
    const dataUrl = 'data:${mimeType};charset=utf-8,' + encodeURIComponent(${dataVar});
    
    try {
        await chrome.downloads.download({
            url: dataUrl,
            filename: ${fileName},
            saveAs: true
        });
        return true;
    } catch (error) {
        console.error('Download failed:', error);
        return false;
    }`;

                // Remove old DOM code and replace with downloads API
                transformed = transformed.replace(
                    /var\s+\w+\s*=\s*document\.createElement\s*\([^;]+;[\s\S]*?\.click\(\);?/,
                    downloadCode
                );
            }

            return transformed;
        });

        return result;
    }

    /**
     * Applies all necessary transformations to a service worker file.
     */
    public static transformServiceWorker(
        extension: Extension,
        serviceWorkerPath: string,
        options: {
            needsWindowOnload: boolean;
            needsLocalStorage: boolean;
            needsDOMDownload: boolean;
        }
    ): LazyFile | null {
        const swFile = extension.files.find((f) => f.path === serviceWorkerPath);
        if (!swFile) {
            return null;
        }

        try {
            let content = swFile.getContent();
            let modified = false;

            // 1. Replace window.onload with self-executing async function
            if (options.needsWindowOnload) {
                content = ServiceWorkerTransformer.replaceWindowOnload(content);
                modified = true;
                logger.info(extension, 'Replaced window.onload with service worker initialization');
            }

            // 2. Replace localStorage with chrome.storage.local
            if (options.needsLocalStorage) {
                content = ServiceWorkerTransformer.replaceLocalStorage(content);
                modified = true;
                logger.info(extension, 'Migrated localStorage to chrome.storage.local');
            }

            // 2.5. Convert callback-based chrome API calls to async/await
            content = ServiceWorkerTransformer.convertCallbacksToAsync(content);
            modified = true;

            // 3. Replace DOM download with chrome.downloads API
            if (options.needsDOMDownload) {
                content = ServiceWorkerTransformer.replaceDOMDownloads(content);
                modified = true;
                logger.info(extension, 'Migrated DOM-based downloads to chrome.downloads API');
            }

            if (!modified) {
                return null;
            }

            return ServiceWorkerTransformer.createTransformedFile(swFile, content);
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
     * Creates a transformed file with modified content stored in memory.
     */
    private static createTransformedFile(originalFile: LazyFile, newContent: string): LazyFile {
        const transformedFile = Object.create(LazyFile.prototype);

        transformedFile.path = originalFile.path;
        transformedFile.filetype = originalFile.filetype;
        transformedFile._transformedContent = newContent;
        transformedFile._absolutePath = (originalFile as any)._absolutePath;

        // Cache buffer for efficient access
        const contentBuffer = Buffer.from(newContent, 'utf8');

        transformedFile.getContent = () => newContent;
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
        if (originalFile.releaseMemory) {
            originalFile.releaseMemory();
        }

        return transformedFile;
    }
}
