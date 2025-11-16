import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';

/**
 * Detects DOM and window API usage patterns in JavaScript code.
 * These patterns indicate code that won't work in MV3 service workers
 * and need to be moved to offscreen documents.
 */
export class DOMDetector {
    /**
     * Comprehensive patterns that indicate DOM access in JavaScript code.
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
        // Note: Blob, File, FileReader, fetch, FormData work in service workers
        // Only Image requires DOM context
        /\bnew\s+Image\b/,
        /\bnew\s+XMLHttpRequest\b/,
    ];

    /**
     * localStorage patterns for specific detection
     */
    private static readonly LOCALSTORAGE_PATTERNS = [
        /localStorage\.getItem\s*\(/,
        /localStorage\.setItem\s*\(/,
        /localStorage\.removeItem\s*\(/,
        /localStorage\.clear\s*\(/,
        /localStorage\[['"](\w+)['"]\]/,
    ];

    /**
     * window.onload pattern for specific detection
     */
    private static readonly WINDOW_ONLOAD_PATTERN =
        /window\.onload\s*=\s*function\s*\([^)]*\)\s*\{/g;

    /**
     * DOM download pattern detection
     * Matches both .download = and .setAttribute('download', ...)
     */
    private static readonly DOM_DOWNLOAD_PATTERN =
        /document\.createElement\s*\(\s*['"`]a['"`]\s*\)[\s\S]*?(?:\.download\s*=|\.setAttribute\s*\(\s*['"`]download['"`])/;
    private static readonly BLOB_PATTERN = /new\s+Blob\s*\(/;
    private static readonly CREATE_OBJECT_URL = /URL\.createObjectURL\s*\(/;

    /**
     * Checks if a JavaScript file contains DOM access patterns.
     * Intelligently filters out injected code that will run in page context.
     *
     * Note: This method returns true for localStorage/sessionStorage and DOM downloads
     * for backwards compatibility. Use analyzeExtension() to determine if offscreen
     * documents are actually needed.
     */
    public static containsDOMAccess(content: string): boolean {
        // Skip checking if file contains injected code (executeScript patterns)
        if (
            content.includes('chrome.tabs.executeScript') ||
            content.includes('chrome.scripting.executeScript')
        ) {
            // This is injected code that will run in page context, not in service worker
            // Extract the code strings and check only non-injected parts
            let nonInjectedContent = content;

            // Remove code: with single quotes, double quotes, or backticks
            nonInjectedContent = nonInjectedContent.replace(/code:\s*['"][\s\S]*?['"]/g, '');
            nonInjectedContent = nonInjectedContent.replace(/code:\s*`[\s\S]*?`/g, '');

            // Remove func: () => {...} patterns for chrome.scripting.executeScript
            nonInjectedContent = nonInjectedContent.replace(
                /func:\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\}/g,
                ''
            );

            // Check if DOM access is outside of injected code
            return DOMDetector.DOM_ACCESS_PATTERNS.some((pattern) =>
                pattern.test(nonInjectedContent)
            );
        }

        return DOMDetector.DOM_ACCESS_PATTERNS.some((pattern) => pattern.test(content));
    }

    /**
     * Internal method to check if there's DOM access that actually needs offscreen documents.
     * Filters out localStorage (migrated to chrome.storage) and DOM downloads (migrated to chrome.downloads).
     */
    private static needsOffscreenForDOMAccess(content: string): boolean {
        // Check if this has DOM downloads or localStorage usage
        const hasDOMDownload =
            DOMDetector.DOM_DOWNLOAD_PATTERN.test(content) &&
            DOMDetector.BLOB_PATTERN.test(content) &&
            DOMDetector.CREATE_OBJECT_URL.test(content);
        const hasLocalStorage = DOMDetector.LOCALSTORAGE_PATTERNS.some((pattern) =>
            pattern.test(content)
        );

        // If this has DOM downloads or localStorage, check if there's OTHER DOM access
        // that actually needs offscreen documents
        if (hasDOMDownload || hasLocalStorage) {
            // Remove download patterns and localStorage/sessionStorage patterns
            let contentFiltered = content.replace(
                /function\s+\w*\s*\([^)]*\)\s*\{[\s\S]*?document\.createElement\s*\(\s*['"`]a['"`]\s*\)[\s\S]*?(?:\.download\s*=|\.setAttribute\s*\(\s*['"`]download['"`])[\s\S]*?\}/g,
                ''
            );

            // Remove localStorage and sessionStorage patterns
            contentFiltered = contentFiltered.replace(/window\.localStorage/g, '');
            contentFiltered = contentFiltered.replace(/window\.sessionStorage/g, '');
            contentFiltered = contentFiltered.replace(/localStorage\./g, '');
            contentFiltered = contentFiltered.replace(/sessionStorage\./g, '');

            // Check if there's still DOM access after filtering
            return DOMDetector.DOM_ACCESS_PATTERNS.some((pattern) => pattern.test(contentFiltered));
        }

        return DOMDetector.containsDOMAccess(content);
    }

    /**
     * Checks if content contains localStorage usage
     */
    public static containsLocalStorage(content: string): boolean {
        return DOMDetector.LOCALSTORAGE_PATTERNS.some((pattern) => pattern.test(content));
    }

    /**
     * Checks if content contains window.onload
     */
    public static containsWindowOnload(content: string): boolean {
        return DOMDetector.WINDOW_ONLOAD_PATTERN.test(content);
    }

    /**
     * Checks if content contains DOM-based download pattern
     */
    public static containsDOMDownload(content: string): boolean {
        return (
            DOMDetector.DOM_DOWNLOAD_PATTERN.test(content) &&
            DOMDetector.BLOB_PATTERN.test(content) &&
            DOMDetector.CREATE_OBJECT_URL.test(content)
        );
    }

    /**
     * Analyzes an extension to detect if it needs offscreen document migration.
     * Returns detailed information about what issues were found.
     */
    public static analyzeExtension(extension: Extension): {
        needsOffscreen: boolean;
        needsLocalStorage: boolean;
        needsWindowOnload: boolean;
        needsDOMDownload: boolean;
        affectedFiles: string[];
    } {
        const result = {
            needsOffscreen: false,
            needsLocalStorage: false,
            needsWindowOnload: false,
            needsDOMDownload: false,
            affectedFiles: [] as string[],
        };

        // Only check service worker files (MV3 background scripts)
        const serviceWorkerPath = extension.manifest?.background?.service_worker;

        if (!serviceWorkerPath) {
            return result;
        }

        // Find the service worker file
        const serviceWorkerFile = extension.files.find((file) => file.path === serviceWorkerPath);

        if (!serviceWorkerFile || serviceWorkerFile.filetype !== ExtFileType.JS) {
            return result;
        }

        try {
            const content = serviceWorkerFile.getContent();

            // Check for DOM access that actually needs offscreen documents
            if (DOMDetector.needsOffscreenForDOMAccess(content)) {
                result.needsOffscreen = true;
                result.affectedFiles.push(serviceWorkerFile.path);
                logger.info(
                    extension,
                    `Service worker contains DOM access patterns: ${serviceWorkerPath}`
                );
            }

            // Check for localStorage usage
            if (DOMDetector.containsLocalStorage(content)) {
                result.needsLocalStorage = true;
                if (!result.affectedFiles.includes(serviceWorkerFile.path)) {
                    result.affectedFiles.push(serviceWorkerFile.path);
                }
            }

            // Check for window.onload
            if (DOMDetector.containsWindowOnload(content)) {
                result.needsWindowOnload = true;
                if (!result.affectedFiles.includes(serviceWorkerFile.path)) {
                    result.affectedFiles.push(serviceWorkerFile.path);
                }
            }

            // Check for DOM downloads
            if (DOMDetector.containsDOMDownload(content)) {
                result.needsDOMDownload = true;
                if (!result.affectedFiles.includes(serviceWorkerFile.path)) {
                    result.affectedFiles.push(serviceWorkerFile.path);
                }
            }
        } catch (error) {
            logger.warn(
                extension,
                `Failed to read service worker for DOM detection: ${serviceWorkerPath}`,
                error
            );
        }

        return result;
    }

    /**
     * Export patterns for testing
     */
    public static get patterns() {
        return {
            DOM_ACCESS_PATTERNS: DOMDetector.DOM_ACCESS_PATTERNS,
            LOCALSTORAGE_PATTERNS: DOMDetector.LOCALSTORAGE_PATTERNS,
            WINDOW_ONLOAD_PATTERN: DOMDetector.WINDOW_ONLOAD_PATTERN,
            DOM_DOWNLOAD_PATTERN: DOMDetector.DOM_DOWNLOAD_PATTERN,
            BLOB_PATTERN: DOMDetector.BLOB_PATTERN,
            CREATE_OBJECT_URL: DOMDetector.CREATE_OBJECT_URL,
        };
    }
}
