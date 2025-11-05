import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import { logger } from '../utils/logger';
import { Tags } from '../types/tags';

/**
 * This module detects DOM access patterns in service worker/background scripts
 * and creates offscreen documents to handle those operations in MV3.
 * 
 * In Manifest V2, background pages could directly access the DOM.
 * In Manifest V3, service workers cannot access the DOM, so DOM operations
 * must be moved to offscreen documents.
 */
export class OffscreenDocumentMigrator implements MigrationModule {
    private static readonly OFFSCREEN_HTML_FILENAME = 'offscreen.html';
    private static readonly OFFSCREEN_JS_FILENAME = 'offscreen.js';

    /**
     * Patterns that indicate DOM access in JavaScript code.
     * These patterns are commonly used in background pages but are not available in service workers.
     */
    private static readonly DOM_ACCESS_PATTERNS = [
        // Document API
        /\bdocument\.(getElementById|querySelector|querySelectorAll|createElement|createElementNS)\b/,
        /\bdocument\.(body|head|title|cookie|documentElement|forms|images|links|scripts)\b/,
        /\bdocument\.(write|writeln|open|close)\b/,
        /\bnew\s+DOMParser\(\)/,
        /\bdocument\.implementation/,
        
        // Window API (excluding chrome.windows which is the extension API)
        /(?<!chrome\.)window\.(location|history|navigator|screen|localStorage|sessionStorage)\b/,
        /(?<!chrome\.)window\.(alert|confirm|prompt)\b/,
        /(?<!chrome\.)window\.(open|close|focus|blur)\b/,
        /(?<!chrome\.)window\.(innerWidth|innerHeight|outerWidth|outerHeight|scrollX|scrollY)\b/,
        /(?<!chrome\.)window\.(getComputedStyle|matchMedia)\b/,
        
        // DOM manipulation
        /\.(appendChild|removeChild|replaceChild|insertBefore)\b/,
        /\.(innerHTML|outerHTML|textContent|innerText)\s*=/,
        /\.(setAttribute|getAttribute|removeAttribute|hasAttribute)\b/,
        /\.(classList|className|style)\./,
        /\.(addEventListener|removeEventListener|dispatchEvent)\b/,
        
        // Canvas API
        /\bnew\s+(HTMLCanvasElement|CanvasRenderingContext2D|ImageData)\b/,
        /\.getContext\s*\(\s*['"`](2d|webgl|webgl2)['"`]\s*\)/,
        /\.(canvas|fillRect|strokeRect|fillText|strokeText|drawImage)\b/,
        
        // Audio/Video API
        /\bnew\s+(Audio|HTMLAudioElement|HTMLVideoElement|AudioContext|MediaSource)\b/,
        /\.play\s*\(\)/,
        /\.pause\s*\(\)/,
        
        // Web APIs that require a document context
        /\bnew\s+(Blob|File|FileReader|Image|XMLHttpRequest)\b/,
        /\.(fetch|XMLHttpRequest|FormData|URLSearchParams)\b/,
    ];

    /**
     * Checks if a JavaScript file contains DOM access patterns.
     */
    private static containsDOMAccess(content: string): boolean {
        // Skip checking if file is injected code (executeScript patterns)
        if (content.includes('chrome.tabs.executeScript') || content.includes('chrome.scripting.executeScript')) {
            // This is injected code that will run in page context, not in service worker
            // Extract the code strings and check only non-injected parts
            let nonInjectedContent = content;
            
            // Remove code: with single quotes, double quotes, or backticks
            nonInjectedContent = nonInjectedContent.replace(/code:\s*['"][\s\S]*?['"]/g, '');
            nonInjectedContent = nonInjectedContent.replace(/code:\s*`[\s\S]*?`/g, '');
            
            // Remove func: () => {...} patterns for chrome.scripting.executeScript
            nonInjectedContent = nonInjectedContent.replace(/func:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}/g, '');
            
            // Check if DOM access is outside of injected code
            return OffscreenDocumentMigrator.DOM_ACCESS_PATTERNS.some(pattern => 
                pattern.test(nonInjectedContent)
            );
        }

        return OffscreenDocumentMigrator.DOM_ACCESS_PATTERNS.some(pattern => 
            pattern.test(content)
        );
    }

    /**
     * Checks if the extension needs offscreen document migration.
     */
    private static needsOffscreenDocument(extension: Extension): boolean {
        // Only check service worker files (MV3 background scripts)
        const serviceWorkerPath = extension.manifest?.background?.service_worker;
        
        if (!serviceWorkerPath) {
            return false;
        }

        // Find the service worker file
        const serviceWorkerFile = extension.files.find(file => file.path === serviceWorkerPath);
        
        if (!serviceWorkerFile || serviceWorkerFile.filetype !== ExtFileType.JS) {
            return false;
        }

        try {
            const content = serviceWorkerFile.getContent();
            if (OffscreenDocumentMigrator.containsDOMAccess(content)) {
                logger.info(extension, `Service worker contains DOM access patterns: ${serviceWorkerPath}`);
                return true;
            }
        } catch (error) {
            logger.warn(extension, `Failed to read service worker for DOM detection: ${serviceWorkerPath}`, error);
        }

        return false;
    }

    /**
     * Creates the offscreen HTML file.
     */
    private static createOffscreenHTML(): LazyFile {
        const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Offscreen Document</title>
</head>
<body>
    <script src="${OffscreenDocumentMigrator.OFFSCREEN_JS_FILENAME}"></script>
</body>
</html>`;

        const htmlFile = Object.create(LazyFile.prototype);
        htmlFile.path = OffscreenDocumentMigrator.OFFSCREEN_HTML_FILENAME;
        htmlFile.filetype = ExtFileType.HTML;
        htmlFile._offscreenContent = htmlContent;

        htmlFile.getContent = () => htmlContent;
        htmlFile.getSize = () => Buffer.byteLength(htmlContent, 'utf8');
        htmlFile.close = () => { /* No-op for in-memory content */ };
        htmlFile.getAST = () => undefined;
        htmlFile.getBuffer = () => Buffer.from(htmlContent, 'utf8');

        return htmlFile;
    }

    /**
     * Creates the offscreen JavaScript file.
     */
    private static createOffscreenJS(): LazyFile {
        const jsContent = `// Offscreen document script for DOM operations
// This script handles DOM operations that cannot be performed in the service worker

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') {
        return;
    }

    // Handle different types of DOM operations
    switch (message.type) {
        case 'DOM_OPERATION':
            handleDOMOperation(message.operation, message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true; // Keep message channel open for async response

        case 'CANVAS_OPERATION':
            handleCanvasOperation(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        case 'AUDIO_OPERATION':
            handleAudioOperation(message.data)
                .then(result => sendResponse({ success: true, result }))
                .catch(error => sendResponse({ success: false, error: error.message }));
            return true;

        default:
            sendResponse({ success: false, error: 'Unknown operation type' });
    }
});

/**
 * Handle generic DOM operations
 */
async function handleDOMOperation(operation, data) {
    switch (operation) {
        case 'createElement':
            const element = document.createElement(data.tagName);
            if (data.attributes) {
                for (const [key, value] of Object.entries(data.attributes)) {
                    element.setAttribute(key, value);
                }
            }
            if (data.innerHTML) {
                element.innerHTML = data.innerHTML;
            }
            return { elementId: element.id || 'created' };

        case 'querySelector':
            const selectedElement = document.querySelector(data.selector);
            return {
                found: !!selectedElement,
                textContent: selectedElement?.textContent,
                innerHTML: selectedElement?.innerHTML
            };

        case 'localStorage':
            if (data.action === 'get') {
                return localStorage.getItem(data.key);
            } else if (data.action === 'set') {
                localStorage.setItem(data.key, data.value);
                return { success: true };
            } else if (data.action === 'remove') {
                localStorage.removeItem(data.key);
                return { success: true };
            }
            break;

        case 'sessionStorage':
            if (data.action === 'get') {
                return sessionStorage.getItem(data.key);
            } else if (data.action === 'set') {
                sessionStorage.setItem(data.key, data.value);
                return { success: true };
            } else if (data.action === 'remove') {
                sessionStorage.removeItem(data.key);
                return { success: true };
            }
            break;

        default:
            throw new Error(\`Unknown DOM operation: \${operation}\`);
    }
}

/**
 * Handle canvas operations
 */
async function handleCanvasOperation(data) {
    const canvas = document.createElement('canvas');
    canvas.width = data.width || 300;
    canvas.height = data.height || 150;
    
    const ctx = canvas.getContext('2d');
    
    // Execute canvas operations
    if (data.operations && Array.isArray(data.operations)) {
        for (const op of data.operations) {
            if (typeof ctx[op.method] === 'function') {
                ctx[op.method](...(op.args || []));
            } else if (op.property) {
                ctx[op.property] = op.value;
            }
        }
    }
    
    // Return canvas data as URL
    return {
        dataUrl: canvas.toDataURL(data.format || 'image/png')
    };
}

/**
 * Handle audio operations
 */
async function handleAudioOperation(data) {
    if (data.action === 'play') {
        const audio = new Audio(data.src);
        await audio.play();
        return { success: true };
    } else if (data.action === 'stop') {
        // Implementation depends on how audio references are stored
        return { success: true };
    }
    throw new Error(\`Unknown audio operation: \${data.action}\`);
}

console.log('Offscreen document loaded and ready');
`;

        const jsFile = Object.create(LazyFile.prototype);
        jsFile.path = OffscreenDocumentMigrator.OFFSCREEN_JS_FILENAME;
        jsFile.filetype = ExtFileType.JS;
        jsFile._offscreenContent = jsContent;

        jsFile.getContent = () => jsContent;
        jsFile.getSize = () => Buffer.byteLength(jsContent, 'utf8');
        jsFile.close = () => { /* No-op for in-memory content */ };
        jsFile.getAST = () => undefined;
        jsFile.getBuffer = () => Buffer.from(jsContent, 'utf8');

        return jsFile;
    }

    /**
     * Adds helper code to the service worker for managing offscreen documents.
     */
    private static injectOffscreenHelpers(
        extension: Extension,
        serviceWorkerPath: string
    ): LazyFile | null {
        const serviceWorkerFile = extension.files.find(file => file.path === serviceWorkerPath);

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
        url: '${OffscreenDocumentMigrator.OFFSCREEN_HTML_FILENAME}',
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

            logger.info(extension, `Injected offscreen helpers into service worker: ${serviceWorkerPath}`);

            return OffscreenDocumentMigrator.createTransformedFile(serviceWorkerFile, newContent);
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
     * Updates the manifest to add offscreen permission.
     */
    private static updateManifest(manifest: any): any {
        const updatedManifest = JSON.parse(JSON.stringify(manifest));

        // Add offscreen permission if not present
        if (!updatedManifest.permissions) {
            updatedManifest.permissions = [];
        }

        if (!updatedManifest.permissions.includes('offscreen')) {
            updatedManifest.permissions.push('offscreen');
        }

        return updatedManifest;
    }

    /**
     * Main migration method.
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        const startTime = Date.now();

        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Check if the extension needs offscreen document
            if (!OffscreenDocumentMigrator.needsOffscreenDocument(extension)) {
                logger.debug(extension, 'Extension does not need offscreen document migration');
                return extension;
            }

            // Check if offscreen document is already added
            const hasOffscreenHTML = extension.files.some(
                file => file.path === OffscreenDocumentMigrator.OFFSCREEN_HTML_FILENAME
            );
            if (hasOffscreenHTML) {
                logger.debug(extension, 'Offscreen document already added');
                return extension;
            }

            logger.info(extension, 'Adding offscreen document support for DOM operations');

            // Create offscreen files
            const offscreenHTML = OffscreenDocumentMigrator.createOffscreenHTML();
            const offscreenJS = OffscreenDocumentMigrator.createOffscreenJS();

            // Inject helpers into service worker
            const serviceWorkerPath = extension.manifest.background.service_worker;
            const transformedServiceWorker = OffscreenDocumentMigrator.injectOffscreenHelpers(
                extension,
                serviceWorkerPath
            );

            // Update files array
            let updatedFiles = [...extension.files, offscreenHTML, offscreenJS];
            
            if (transformedServiceWorker) {
                updatedFiles = updatedFiles.map(file =>
                    file.path === serviceWorkerPath ? transformedServiceWorker : file
                );
            }

            // Update manifest
            const updatedManifest = OffscreenDocumentMigrator.updateManifest(extension.manifest);

            const duration = Date.now() - startTime;
            logger.info(extension, 'Offscreen document migration completed', {
                duration,
                offscreenFiles: [
                    OffscreenDocumentMigrator.OFFSCREEN_HTML_FILENAME,
                    OffscreenDocumentMigrator.OFFSCREEN_JS_FILENAME
                ]
            });

            // Create updated extension
            const updatedExtension = {
                ...extension,
                manifest: updatedManifest,
                files: updatedFiles
            };

            // Add tag
            if (!updatedExtension.tags) {
                updatedExtension.tags = [];
            }
            const offscreenTag = Tags[Tags.OFFSCREEN_DOCUMENT_ADDED];
            if (!updatedExtension.tags.includes(offscreenTag)) {
                updatedExtension.tags.push(offscreenTag);
            }

            return updatedExtension;
        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error(extension, 'Offscreen document migration failed', {
                error: error instanceof Error ? error.message : String(error),
                duration
            });
            return new MigrationError(extension, error);
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

        transformedFile.getContent = () => newContent;
        transformedFile.getSize = () => Buffer.byteLength(newContent, 'utf8');
        transformedFile.close = () => { /* No-op for in-memory content */ };
        transformedFile.getAST = () => undefined;
        transformedFile.getBuffer = () => Buffer.from(newContent, 'utf8');

        return transformedFile;
    }

    /**
     * Helper methods for testing.
     */
    public static testHelpers = {
        needsOffscreenDocument: OffscreenDocumentMigrator.needsOffscreenDocument,
        containsDOMAccess: OffscreenDocumentMigrator.containsDOMAccess,
        createOffscreenHTML: OffscreenDocumentMigrator.createOffscreenHTML,
        createOffscreenJS: OffscreenDocumentMigrator.createOffscreenJS,
        injectOffscreenHelpers: OffscreenDocumentMigrator.injectOffscreenHelpers,
        updateManifest: OffscreenDocumentMigrator.updateManifest,
        OFFSCREEN_HTML_FILENAME: OffscreenDocumentMigrator.OFFSCREEN_HTML_FILENAME,
        OFFSCREEN_JS_FILENAME: OffscreenDocumentMigrator.OFFSCREEN_JS_FILENAME,
        DOM_ACCESS_PATTERNS: OffscreenDocumentMigrator.DOM_ACCESS_PATTERNS
    };
}
