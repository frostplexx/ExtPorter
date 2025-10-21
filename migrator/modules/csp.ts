import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { logger } from '../utils/logger';
import { Tags } from '../types/tags';

/**
 * Migration module for handling Content Security Policy (CSP) transformation
 * from Manifest V2 to Manifest V3 format
 */
export class MigrateCSP implements MigrationModule {

    static current_ext: Extension | null = null;

    /**
     * Migrates Content Security Policy from MV2 to MV3 format
     * @param extension The extension to migrate CSP for
     * @returns The extension with migrated CSP or a MigrationError
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        MigrateCSP.current_ext = extension;
        try {
            const csp = extension.manifest["content_security_policy"];

            // Default MV3 CSP structure
            const defaultMV3CSP = {
                "extension_pages": "script-src 'self'; object-src 'self';",
                "sandbox": "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';"
            };

            // If no CSP exists, set the default
            if (!csp || typeof csp !== 'string') {
                extension.manifest["content_security_policy"] = defaultMV3CSP;
                logger.info(extension, "No CSP found, using default MV3 CSP");
                return extension;
            }

            // MV2 CSP is a string - check if it's compliant
            if (MigrateCSP.isCSPStringCompliant(csp)) {
                // Compliant - just convert to MV3 object format
                extension.manifest["content_security_policy"] = {
                    "extension_pages": csp,
                    "sandbox": defaultMV3CSP.sandbox
                };
                logger.info(extension, "Transformed compliant MV2 CSP to MV3 format");
                return extension;
            } else {
                // Non-compliant - transform to make it compliant
                const compliantCSP = MigrateCSP.makeCSPStringCompliant(csp);
                extension.manifest["content_security_policy"] = {
                    "extension_pages": compliantCSP,
                    "sandbox": defaultMV3CSP.sandbox
                };
                logger.warn(extension, `Transformed non-compliant CSP from: "${csp}" to: "${compliantCSP}"`);

                // Add CSP_VALUE_MODIFIED tag to extension object
                if (!extension.tags) {
                    extension.tags = [];
                }
                const cspTag = Tags[Tags.CSP_VALUE_MODIFIED];
                if (!extension.tags.includes(cspTag)) {
                    extension.tags.push(cspTag);
                }

                return extension;
            }

        } catch (error) {
            logger.error(extension, 'Failed to migrate CSP', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }



    /**
     * Checks if a CSP string is compliant with MV3 requirements
     * @param csp The CSP string to check
     * @returns true if compliant, false otherwise
     */
    private static isCSPStringCompliant(csp: string): boolean {
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
            if (token.startsWith("'") || token.startsWith('http://localhost') || token.startsWith('http://127.0.0.1')) {
                continue;
            }

            // If it ends with .js or contains / (indicating a file path), it's invalid
            if (token.endsWith('.js') || (token.includes('/') && !token.startsWith('http'))) {
                return false;
            }
        }

        return true;
    }

    /**
     * Makes a CSP string compliant with MV3 restrictions
     * Removes or replaces non-compliant values in script-src, object-src, and worker-src
     * @param csp The CSP string to make compliant
     * @returns A compliant CSP string
     */
    private static makeCSPStringCompliant(csp: string): string {
        // Allowed values for script-src, object-src, and worker-src in MV3
        const allowedValues = new Set([
            "'self'",
            "'none'",
            "'wasm-unsafe-eval'",
            // Localhost sources (for unpacked extensions)
            'http://localhost',
            'http://127.0.0.1',
            'https://localhost',
            'https://127.0.0.1'
        ]);

        // Parse the CSP into directives
        const directives = csp.split(';').map(d => d.trim()).filter(d => d.length > 0);
        const transformedDirectives: string[] = [];

        for (const directive of directives) {
            const parts = directive.split(/\s+/);
            if (parts.length === 0) continue;

            const directiveName = parts[0].toLowerCase();

            // Skip invalid directive names (must end with -src or be 'sandbox')
            const validDirectivePattern = /-src$|^sandbox$/;
            if (!validDirectivePattern.test(directiveName)) {
                // Skip this invalid directive
                continue;
            }

            const directiveValues = parts.slice(1);

            // Directives that need to be restricted in MV3
            if (directiveName === 'script-src' || directiveName === 'object-src' || directiveName === 'worker-src') {
                const compliantValues = MigrateCSP.filterCompliantValues(directiveValues, allowedValues);

                // Ensure at least 'self' is present if no compliant values remain
                if (compliantValues.length === 0) {
                    compliantValues.push("'self'");
                }

                transformedDirectives.push(`${directiveName} ${compliantValues.join(' ')}`);
            }
            // For style-src, remove unsafe-inline and unsafe-eval
            else if (directiveName === 'style-src') {
                const filteredValues = directiveValues.filter(v =>
                    !v.toLowerCase().includes('unsafe-inline') &&
                    !v.toLowerCase().includes('unsafe-eval')
                );
                if (filteredValues.length > 0) {
                    transformedDirectives.push(`${directiveName} ${filteredValues.join(' ')}`);
                }
            }
            // Other directives can be kept as-is
            else {
                transformedDirectives.push(directive);
            }
        }

        // Ensure required directives exist
        const hasScriptSrc = transformedDirectives.some(d => d.toLowerCase().startsWith('script-src'));
        const hasObjectSrc = transformedDirectives.some(d => d.toLowerCase().startsWith('object-src'));

        if (!hasScriptSrc) {
            transformedDirectives.push("script-src 'self'");
        }
        if (!hasObjectSrc) {
            transformedDirectives.push("object-src 'self'");
        }

        return transformedDirectives.join('; ');
    }

    /**
     * Filters directive values to only include MV3-compliant values
     * @param values The directive values to filter
     * @param allowedValues Set of allowed values
     * @returns Array of compliant values
     */
    private static filterCompliantValues(values: string[], allowedValues: Set<string>): string[] {
        const compliantValues: string[] = [];

        for (const value of values) {
            const valueLower = value.toLowerCase();

            // Check if it's an explicitly allowed value
            if (allowedValues.has(valueLower)) {
                compliantValues.push(value);
                continue;
            }

            // Check for localhost with port (e.g., http://localhost:8080)
            if (valueLower.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/)) {
                compliantValues.push(value);
                continue;
            }

            // Skip any other values (they are non-compliant):
            // - 'unsafe-eval'
            // - 'unsafe-inline'
            // - Remote URLs
            // - Wildcards
            // - Hash or nonce values (should be kept, but checking for them)
            if (valueLower.startsWith("'sha") || valueLower.startsWith("'nonce-")) {
                // Hashes and nonces are allowed in MV3
                compliantValues.push(value);
            }
        }

        return compliantValues;
    }

}
