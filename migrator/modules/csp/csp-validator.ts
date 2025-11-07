/**
 * CSP validation utilities for Manifest V3 compliance
 */
export class cspValidator {
    /**
     * Checks if a CSP string is compliant with MV3 requirements
     * @param csp The CSP string to check
     * @returns true if compliant, false otherwise
     */
    static isCSPStringCompliant(csp: string): boolean {
        // MV3 CSP requirements:
        // 1. Cannot use 'unsafe-eval', 'unsafe-inline' in script-src
        // 2. Cannot use remotely hosted scripts
        // 3. Cannot use data:, blob: schemes
        // 4. Must use 'self' for script-src
        // 5. object-src must be defined

        const cspLower = csp.toLowerCase();

        // Check that script-src exists
        if (!cspLower.includes('script-src')) {
            return false;
        }

        // Check that object-src exists
        if (!cspLower.includes('object-src')) {
            return false;
        }

        // Extract script-src directive
        const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/i);
        if (!scriptSrcMatch) {
            return false;
        }

        const scriptSrcValue = scriptSrcMatch[1].toLowerCase();

        // Check that script-src includes 'self'
        if (!scriptSrcValue.includes("'self'")) {
            return false;
        }

        // Check for unsafe-eval (not allowed in extension_pages in MV3)
        if (scriptSrcValue.includes("'unsafe-eval'")) {
            return false;
        }

        // Check for unsafe-inline (not allowed in MV3)
        if (scriptSrcValue.includes("'unsafe-inline'")) {
            return false;
        }

        // Check for data: and blob: (not allowed)
        if (scriptSrcValue.includes('data:') || scriptSrcValue.includes('blob:')) {
            return false;
        }

        // Check for remotely hosted scripts (http://, https://, or wildcard domains)
        // Exclude localhost which is allowed
        const hasRemoteScripts = /https?:\/\/(?!localhost|127\.0\.0\.1)/i.test(scriptSrcValue);
        if (hasRemoteScripts) {
            return false;
        }

        // Check for wildcards
        if (scriptSrcValue.includes('*')) {
            return false;
        }

        // Check for bare file paths (paths that don't start with quotes or special schemes)
        // File paths like "script.js" or "path/to/file.js" are not allowed
        const tokens = scriptSrcValue.split(/\s+/);
        for (const token of tokens) {
            // Skip empty tokens
            if (!token) continue;

            // Skip known good values
            if (
                token.startsWith("'") ||
                token.startsWith('http://localhost') ||
                token.startsWith('http://127.0.0.1')
            ) {
                continue;
            }

            // If it ends with .js or contains / (indicating a file path), it's invalid
            if (token.endsWith('.js') || (token.includes('/') && !token.startsWith('http'))) {
                return false;
            }
        }

        return true;
    }
}
