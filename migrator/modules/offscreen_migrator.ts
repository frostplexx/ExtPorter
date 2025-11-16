import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import { logger } from '../utils/logger';

/**
 * This module handles migration of DOM and window API calls to offscreen documents
 * as required by Manifest V3 service workers.
 *
 * According to Google's migration guide, service workers cannot access DOM or window APIs.
 * These calls must be moved to offscreen documents and communicated via message passing.
 */
export class OffscreenMigrator implements MigrationModule {
    private static readonly OFFSCREEN_HTML = 'offscreen.html';
    private static readonly OFFSCREEN_JS = 'offscreen.js';

    /**
     * Patterns that indicate DOM or window API usage that needs offscreen document
     */
    private static readonly DOM_WINDOW_PATTERNS = [
        /\bwindow\./,
        /\bdocument\./,
        /\blocalStorage\./,
        /\bsessionStorage\./,
        /\bnavigator\.clipboard\./,
        /\b(HTMLElement|HTMLDocument|DOMParser|Element|Node|NodeList|DocumentFragment|ShadowRoot|HTMLCollection|HTMLInputElement|HTMLCanvasElement|HTMLImageElement|HTMLFormElement|HTMLButtonElement|HTMLAnchorElement|HTMLTableElement|HTMLTableRowElement|HTMLTableCellElement)\b/,
        /\b(querySelector|getElementById|createElement)\b/,
        /\b(addEventListener|removeEventListener)\b/,
        /\b(getComputedStyle|matchMedia)\b/,
        /\bAudioContext\b/,
        /\bCanvasRenderingContext\b/,
    ];

    /**
     * localStorage patterns to migrate to chrome.storage
     */
    private static readonly LOCALSTORAGE_PATTERNS = [
        /localStorage\.getItem\s*\(/,
        /localStorage\.setItem\s*\(/,
        /localStorage\.removeItem\s*\(/,
        /localStorage\.clear\s*\(/,
        /localStorage\[['"](\w+)['"]\]/,
    ];

    /**
     * Detect if service worker files use DOM/window APIs
     */
    private static needsOffscreenDocument(extension: Extension): {
        needsOffscreen: boolean;
        needsLocalStorageMigration: boolean;
        affectedFiles: string[];
    } {
        const affectedFiles: string[] = [];
        let needsOffscreen = false;
        let needsLocalStorageMigration = false;

        // Check service worker file
        const serviceWorker = extension.manifest.background?.service_worker;
        if (serviceWorker) {
            const swFile = extension.files.find((f) => f.path === serviceWorker);
            if (swFile && swFile.filetype === ExtFileType.JS) {
                try {
                    const content = swFile.getContent();

                    // Check for DOM/window API usage
                    for (const pattern of OffscreenMigrator.DOM_WINDOW_PATTERNS) {
                        if (pattern.test(content)) {
                            needsOffscreen = true;
                            affectedFiles.push(swFile.path);
                            break;
                        }
                    }

                    // Check for localStorage usage
                    for (const pattern of OffscreenMigrator.LOCALSTORAGE_PATTERNS) {
                        if (pattern.test(content)) {
                            needsLocalStorageMigration = true;
                            if (!affectedFiles.includes(swFile.path)) {
                                affectedFiles.push(swFile.path);
                            }
                        }
                    }
                } catch (error) {
                    logger.warn(
                        extension,
                        `Failed to check service worker for DOM/window usage: ${swFile.path}`,
                        error
                    );
                }
            }
        }

        return { needsOffscreen, needsLocalStorageMigration, affectedFiles };
    }

    /**
     * Create offscreen document HTML file
     */
    private static createOffscreenHTML(): LazyFile {
        const content = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Offscreen Document</title>
</head>
<body>
    <script src="${OffscreenMigrator.OFFSCREEN_JS}"></script>
</body>
</html>`;

        const file = Object.create(LazyFile.prototype);
        file.path = OffscreenMigrator.OFFSCREEN_HTML;
        file.filetype = ExtFileType.HTML;
        file.getContent = () => content;
        file.getSize = () => Buffer.byteLength(content, 'utf8');
        file.close = () => {};
        file.getAST = () => undefined;

        return file;
    }

    /**
     * Create offscreen document JavaScript file
     */
    private static createOffscreenJS(): LazyFile {
        const content = `// Offscreen document for DOM and window API access
// This file handles operations that cannot be performed in a service worker

/**
 * Message handler for offscreen document operations
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;

  switch (type) {
    case 'DOM_OPERATION':
      handleDOMOperation(data).then(sendResponse);
      return true; // Keep channel open for async response

    case 'CLIPBOARD_WRITE':
      handleClipboardWrite(data).then(sendResponse);
      return true;

    case 'CLIPBOARD_READ':
      handleClipboardRead().then(sendResponse);
      return true;

    case 'LOCALSTORAGE_GET':
      handleLocalStorageGet(data).then(sendResponse);
      return true;

    case 'LOCALSTORAGE_SET':
      handleLocalStorageSet(data).then(sendResponse);
      return true;

    case 'LOCALSTORAGE_REMOVE':
      handleLocalStorageRemove(data).then(sendResponse);
      return true;

    case 'LOCALSTORAGE_CLEAR':
      handleLocalStorageClear().then(sendResponse);
      return true;

    default:
      console.warn('Unknown offscreen operation type:', type);
      sendResponse({ success: false, error: 'Unknown operation' });
  }
});

/**
 * Handle generic DOM operations
 */
async function handleDOMOperation(data) {
  try {
    const { operation, params } = data;
    let result;

    switch (operation) {
      case 'querySelector':
        result = document.querySelector(params.selector);
        return { success: true, result: result ? result.outerHTML : null };

      case 'createElement':
        result = document.createElement(params.tagName);
        return { success: true, result: result.outerHTML };

      default:
        return { success: false, error: 'Unknown DOM operation' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle clipboard write operations
 */
async function handleClipboardWrite(data) {
  try {
    const { text } = data;
    
    // Create temporary textarea for clipboard access
    const textEl = document.createElement('textarea');
    textEl.value = text;
    document.body.appendChild(textEl);
    textEl.select();
    document.execCommand('copy');
    document.body.removeChild(textEl);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle clipboard read operations
 */
async function handleClipboardRead() {
  try {
    // Try modern clipboard API first
    if (navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      return { success: true, text };
    }

    // Fallback to older method
    const textEl = document.createElement('textarea');
    document.body.appendChild(textEl);
    textEl.select();
    document.execCommand('paste');
    const text = textEl.value;
    document.body.removeChild(textEl);

    return { success: true, text };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle localStorage.getItem()
 */
async function handleLocalStorageGet(data) {
  try {
    const { key } = data;
    const value = localStorage.getItem(key);
    return { success: true, value };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle localStorage.setItem()
 */
async function handleLocalStorageSet(data) {
  try {
    const { key, value } = data;
    localStorage.setItem(key, value);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle localStorage.removeItem()
 */
async function handleLocalStorageRemove(data) {
  try {
    const { key } = data;
    localStorage.removeItem(key);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Handle localStorage.clear()
 */
async function handleLocalStorageClear() {
  try {
    localStorage.clear();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

console.log('Offscreen document loaded and ready');
`;

        const file = Object.create(LazyFile.prototype);
        file.path = OffscreenMigrator.OFFSCREEN_JS;
        file.filetype = ExtFileType.JS;
        file.getContent = () => content;
        file.getSize = () => Buffer.byteLength(content, 'utf8');
        file.close = () => {};
        file.getAST = () => undefined;

        return file;
    }

    /**
     * Transform service worker to use offscreen document
     */
    private static transformServiceWorker(
        extension: Extension,
        serviceWorkerPath: string,
        needsLocalStorage: boolean
    ): LazyFile | null {
        const swFile = extension.files.find((f) => f.path === serviceWorkerPath);
        if (!swFile) {
            return null;
        }

        try {
            let content = swFile.getContent();

            // Add offscreen document management code at the top
            const offscreenSetup = `
// Offscreen document management
let offscreenCreated = false;

async function setupOffscreenDocument() {
  if (offscreenCreated) {
    return;
  }

  try {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('${OffscreenMigrator.OFFSCREEN_HTML}'),
      reasons: ['${needsLocalStorage ? 'LOCAL_STORAGE' : 'DOM_SCRAPING'}'],
      justification: 'Required for DOM and window API access in Manifest V3',
    });
    offscreenCreated = true;
  } catch (error) {
    // Document may already exist
    if (!error.message.includes('Only a single offscreen')) {
      console.error('Failed to create offscreen document:', error);
    }
  }
}

async function closeOffscreenDocument() {
  if (!offscreenCreated) {
    return;
  }
  try {
    await chrome.offscreen.closeDocument();
    offscreenCreated = false;
  } catch (error) {
    console.error('Failed to close offscreen document:', error);
  }
}

// Helper to send messages to offscreen document
async function sendToOffscreen(type, data = {}) {
  await setupOffscreenDocument();
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

`;

            // Add setup at the beginning
            content = offscreenSetup + '\n' + content;

            // Transform localStorage calls to use chrome.storage.local
            if (needsLocalStorage) {
                // localStorage.getItem(key) -> await chrome.storage.local.get([key])
                content = content.replace(
                    /localStorage\.getItem\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
                    '(await chrome.storage.local.get(["$2"]))["$2"]'
                );

                // localStorage.setItem(key, value) -> await chrome.storage.local.set({key: value})
                content = content.replace(
                    /localStorage\.setItem\s*\(\s*([^)]*)\)/g,
                    (match, args) => {
                        // Try to split args into key and value
                        // This is a best-effort split on the first comma not inside quotes or parentheses
                        let key = '';
                        let value = '';
                        let depth = 0;
                        let inQuote = null;
                        let splitIdx = -1;
                        for (let i = 0; i < args.length; i++) {
                            const c = args[i];
                            if (inQuote) {
                                if (c === inQuote && args[i-1] !== '\\') inQuote = null;
                            } else if (c === '"' || c === "'" || c === '`') {
                                inQuote = c;
                            } else if (c === '(') {
                                depth++;
                            } else if (c === ')') {
                                depth--;
                            } else if (c === ',' && depth === 0) {
                                splitIdx = i;
                                break;
                            }
                        }
                        if (splitIdx !== -1) {
                            key = args.slice(0, splitIdx).trim();
                            value = args.slice(splitIdx + 1).trim();
                        } else {
                            // fallback: treat all as key, no value
                            key = args.trim();
                            value = 'undefined';
                        }
                        // Remove quotes from key if present
                        const keyMatch = key.match(/^(['"`])(.+)\1$/);
                        const keyStr = keyMatch ? keyMatch[2] : key;
                        return `await chrome.storage.local.set({${JSON.stringify(keyStr)}: ${value}})`;
                    }
                );

                // localStorage.removeItem(key) -> await chrome.storage.local.remove([key])
                content = content.replace(
                    /localStorage\.removeItem\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g,
                    'await chrome.storage.local.remove(["$2"])'
                );

                // localStorage.clear() -> await chrome.storage.local.clear()
                content = content.replace(
                    /localStorage\.clear\s*\(\s*\)/g,
                    'await chrome.storage.local.clear()'
                );

                logger.info(extension, 'Migrated localStorage calls to chrome.storage.local');
            }

            // Create transformed file
            const transformedFile = Object.create(LazyFile.prototype);
            transformedFile.path = swFile.path;
            transformedFile.filetype = swFile.filetype;
            transformedFile.getContent = () => content;
            transformedFile.getSize = () => Buffer.byteLength(content, 'utf8');
            transformedFile.close = swFile.close;
            transformedFile.getAST = () => undefined;

            return transformedFile;
        } catch (error) {
            logger.error(
                extension,
                `Failed to transform service worker for offscreen document: ${error}`,
                error
            );
            return null;
        }
    }

    /**
     * Update manifest to declare offscreen permission
     */
    private static updateManifest(manifest: any): any {
        const updatedManifest = JSON.parse(JSON.stringify(manifest));

        // Add offscreen permission
        if (!updatedManifest.permissions) {
            updatedManifest.permissions = [];
        }

        if (!updatedManifest.permissions.includes('offscreen')) {
            updatedManifest.permissions.push('offscreen');
            logger.debug(null, 'Added offscreen permission to manifest');
        }

        // Add storage permission if not present (for localStorage migration)
        if (!updatedManifest.permissions.includes('storage')) {
            updatedManifest.permissions.push('storage');
            logger.debug(null, 'Added storage permission to manifest');
        }

        return updatedManifest;
    }

    /**
     * Main migration method
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            // Only apply to MV3 extensions with service workers
            if (extension.manifest.manifest_version !== 3) {
                return extension;
            }

            if (!extension.manifest.background?.service_worker) {
                return extension;
            }

            // Check if offscreen document is needed
            const { needsOffscreen, needsLocalStorageMigration, affectedFiles } =
                OffscreenMigrator.needsOffscreenDocument(extension);

            if (!needsOffscreen && !needsLocalStorageMigration) {
                logger.debug(extension, 'No offscreen document migration needed');
                return extension;
            }

            logger.info(
                extension,
                `Migrating to offscreen document (localStorage: ${needsLocalStorageMigration})`,
                { affectedFiles }
            );

            // Check if offscreen files already exist
            const hasOffscreenHTML = extension.files.some(
                (f) => f.path === OffscreenMigrator.OFFSCREEN_HTML
            );
            const hasOffscreenJS = extension.files.some(
                (f) => f.path === OffscreenMigrator.OFFSCREEN_JS
            );

            if (hasOffscreenHTML && hasOffscreenJS) {
                logger.debug(extension, 'Offscreen documents already exist');
                return extension;
            }

            // Create offscreen document files
            const offscreenHTML = OffscreenMigrator.createOffscreenHTML();
            const offscreenJS = OffscreenMigrator.createOffscreenJS();

            // Transform service worker
            const transformedSW = OffscreenMigrator.transformServiceWorker(
                extension,
                extension.manifest.background.service_worker,
                needsLocalStorageMigration
            );

            // Update files
            let updatedFiles = [...extension.files];
            if (transformedSW) {
                updatedFiles = updatedFiles.map((f) =>
                    f.path === transformedSW.path ? transformedSW : f
                );
            }

            // Add offscreen files
            if (!hasOffscreenHTML) {
                updatedFiles.push(offscreenHTML);
            }
            if (!hasOffscreenJS) {
                updatedFiles.push(offscreenJS);
            }

            // Update manifest
            const updatedManifest = OffscreenMigrator.updateManifest(extension.manifest);

            logger.info(extension, 'Successfully migrated to use offscreen document');

            return {
                ...extension,
                manifest: updatedManifest,
                files: updatedFiles,
            };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error during migration';
            logger.error(extension, `Offscreen document migration failed: ${errorMessage}`, error);
            return new MigrationError(extension, new Error(errorMessage));
        }
    }

    // Test helpers for unit tests
    public static testHelpers = {
        OFFSCREEN_HTML: OffscreenMigrator.OFFSCREEN_HTML,
        OFFSCREEN_JS: OffscreenMigrator.OFFSCREEN_JS,
        needsOffscreenDocument: OffscreenMigrator.needsOffscreenDocument,
        createOffscreenHTML: OffscreenMigrator.createOffscreenHTML,
        createOffscreenJS: OffscreenMigrator.createOffscreenJS,
        transformServiceWorker: OffscreenMigrator.transformServiceWorker,
        updateManifest: OffscreenMigrator.updateManifest,
    };
}
