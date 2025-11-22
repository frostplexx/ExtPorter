import { Extension } from '../../types/extension';

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
 */
export function extractListeners(extension: Extension): EventListener[] {
    const listeners: EventListener[] = [];
    const seen = new Set<string>(); // Deduplicate listeners

    // Regex to match event listener patterns
    // Matches: chrome.runtime.onMessage.addListener, browser.tabs.onUpdated.addListener, etc.
    const listenerRegex = /(chrome|browser)\.(\w+)\.(\w+)\.addListener\s*\(/g;

    for (const file of extension.files) {
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
 * Check if a file path indicates a JavaScript file
 */
function isJavaScriptFile(path: string): boolean {
    const ext = path.toLowerCase().split('.').pop() || '';
    return ext === 'js' || ext === 'mjs' || ext === 'cjs';
}
