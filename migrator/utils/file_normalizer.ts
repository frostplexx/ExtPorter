/**
 * Utility functions for normalizing file content
 * Handles line ending normalization and cleanup
 */

/**
 * Normalize line endings to LF and clean up whitespace
 * @param content The file content to normalize
 * @returns Normalized content with LF line endings and proper EOF handling
 */
export function normalizeFileContent(content: string): string {
    if (!content) {
        return content;
    }

    // Step 1: Normalize all line endings to LF
    let normalized = content.replace(/\r\n/g, '\n'); // CRLF -> LF
    normalized = normalized.replace(/\r/g, '\n'); // CR -> LF

    // Step 2: Remove trailing whitespace from each line
    normalized = normalized
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n');

    // Step 3: Remove any trailing empty lines and whitespace at end of file
    normalized = normalized.trimEnd();

    // Step 4: Ensure single newline at end of file (POSIX standard)
    if (normalized && !normalized.endsWith('\n')) {
        normalized += '\n';
    }

    return normalized;
}

/**
 * Normalize JavaScript/TypeScript content
 * Additional cleanup specific to code files
 * @param content The JavaScript content to normalize
 * @returns Normalized JavaScript content
 */
export function normalizeJavaScriptContent(content: string): string {
    if (!content) {
        return content;
    }

    let normalized = normalizeFileContent(content);

    // Remove duplicate semicolons at end of functions
    // Pattern: };\n; -> };\n
    normalized = normalized.replace(/}\s*;\s*\n\s*;/g, '};\n');

    // Remove standalone semicolons on their own line
    normalized = normalized.replace(/\n\s*;\s*\n/g, '\n');
    normalized = normalized.replace(/\n\s*;\s*$/g, '\n');

    return normalized;
}

/**
 * Normalize JSON content
 * @param content The JSON content to normalize
 * @returns Normalized JSON content
 */
export function normalizeJSONContent(content: string): string {
    if (!content) {
        return content;
    }

    // For JSON, just normalize line endings and ensure EOF newline
    let normalized = normalizeFileContent(content);

    // Ensure proper JSON formatting (no trailing commas, proper spacing)
    try {
        const parsed = JSON.parse(normalized);
        normalized = JSON.stringify(parsed, null, 2);

        // Add final newline
        if (!normalized.endsWith('\n')) {
            normalized += '\n';
        }
    } catch (error) {
        // If JSON parsing fails, just return the normalized version
        // without reformatting
    }

    return normalized;
}

/**
 * Normalize HTML content
 * @param content The HTML content to normalize
 * @returns Normalized HTML content
 */
export function normalizeHTMLContent(content: string): string {
    if (!content) {
        return content;
    }

    // For HTML, just normalize line endings and whitespace
    return normalizeFileContent(content);
}

/**
 * Normalize CSS content
 * @param content The CSS content to normalize
 * @returns Normalized CSS content
 */
export function normalizeCSSContent(content: string): string {
    if (!content) {
        return content;
    }

    // For CSS, just normalize line endings and whitespace
    return normalizeFileContent(content);
}

/**
 * Detect and report line ending statistics for debugging
 * @param content The content to analyze
 * @returns Statistics about line endings
 */
export function analyzeLineEndings(content: string): {
    crlf: number;
    lf: number;
    cr: number;
    total: number;
} {
    const crlf = (content.match(/\r\n/g) || []).length;
    const cr = (content.match(/\r(?!\n)/g) || []).length;
    const lf = (content.match(/(?<!\r)\n/g) || []).length;

    return {
        crlf,
        lf,
        cr,
        total: crlf + lf + cr,
    };
}
