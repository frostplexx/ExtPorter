import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import * as path from 'path';

export interface EventListener {
    api: string; // e.g., "chrome.runtime.onMessage"
    file: string; // File path where listener was found
    line?: number; // Line number (if available)
    code_snippet?: string; // Short snippet of the listener code
}

/**
 * Extract all event listeners from extension files
 * Looks for patterns like:
 * - chrome.*.on*.addListener(...)
 * - browser.*.on*.addListener(...)
 *
 * Only extracts from V2 version of the extension to avoid duplicates
 */
export function extractListeners(extension: Extension): EventListener[] {
    const listeners: EventListener[] = [];
    const seen = new Set<string>(); // Deduplicate listeners

    // Regex to match event listener patterns
    // Matches: chrome.runtime.onMessage.addListener, browser.tabs.onUpdated.addListener, etc.
    const listenerRegex = /(chrome|browser)\.(\w+)\.(\w+)\.addListener\s*\(/g;

    // Determine the V2 base path for filtering
    const v2BasePath = getV2BasePath(extension);

    for (const file of extension.files) {

        if(file == null){
            console.error(extension, "File is null");
            break;
        }

        // Only analyze files from the V2 version
        if (!isFileInV2Version(file.path, v2BasePath, extension)) {
            continue;
        }

        // Only analyze JavaScript files
        if (!isJavaScriptFile(file.path)) {
            continue;
        }

        // Get file content
        let content: string;
        try {
            content = file.getContent();
        } catch (error) {
            // Skip files that can't be read
            logger.error(null, error as any);
            continue;
        }

        if (!content || typeof content !== 'string') {
            continue;
        }

        // Split content into lines for line number tracking
        const lines = content.split('\n');

        // Find all matches
        let match;
        listenerRegex.lastIndex = 0; // Reset regex

        while ((match = listenerRegex.exec(content)) !== null) {
            const namespace = match[1]; // "chrome" or "browser"
            const api = match[2]; // e.g., "runtime", "tabs"
            const event = match[3]; // e.g., "onMessage", "onUpdated"

            // Construct the full API path
            const apiPath = `${namespace}.${api}.${event}`;

            // Create unique key to avoid duplicates
            const key = `${apiPath}:${file.path}`;
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);

            // Find line number
            const matchIndex = match.index;
            const lineNumber = content.substring(0, matchIndex).split('\n').length;

            // Extract code snippet (the line containing the listener)
            const snippetLine = lines[lineNumber - 1] || '';
            const snippet = snippetLine.trim().substring(0, 100); // Max 100 chars

            listeners.push({
                api: apiPath,
                file: file.path,
                line: lineNumber,
                code_snippet: snippet,
            });
        }
    }

    // Sort by API name for consistency
    listeners.sort((a, b) => {
        if (a.api !== b.api) {
            return a.api.localeCompare(b.api);
        }
        return a.file.localeCompare(b.file);
    });

    return listeners;
}

/**
 * Get the base path for the V2 version of the extension
 */
function getV2BasePath(extension: Extension): string {
    const v2Path = extension.manifest_v2_path;

    // If the path ends with manifest.json, get the directory
    if (v2Path.endsWith('manifest.json')) {
        return path.dirname(v2Path);
    }

    return v2Path;
}

/**
 * Check if a file belongs to the V2 version
 * Files in the V2 version are those that don't belong to the V3 migrated version
 */
function isFileInV2Version(filePath: string, v2BasePath: string, extension: Extension): boolean {
    // If there's no V3 path, all files are V2
    if (!extension.manifest_v3_path) {
        return true;
    }

    // Get the V3 base path
    const v3Path = extension.manifest_v3_path;
    const v3BasePath = v3Path.endsWith('manifest.json') ? path.dirname(v3Path) : v3Path;

    // Normalize paths for comparison
    const normalizedFilePath = path.normalize(filePath);
    const normalizedV2Base = path.normalize(v2BasePath);
    const normalizedV3Base = path.normalize(v3BasePath);

    // Check if file is under V2 base path and NOT under V3 base path
    const isInV2 = normalizedFilePath.startsWith(normalizedV2Base);
    const isInV3 = normalizedFilePath.startsWith(normalizedV3Base);

    // File belongs to V2 if it's in V2 path and not in V3 path
    return isInV2 && !isInV3;
}

/**
 * Check if a file path indicates a JavaScript file
 */
function isJavaScriptFile(path: string): boolean {
    const ext = path.toLowerCase().split('.').pop() || '';
    return ext === 'js' || ext === 'mjs' || ext === 'cjs';
}
