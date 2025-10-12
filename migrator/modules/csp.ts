import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { logger } from '../utils/logger';

/**
 * Migration module for handling Content Security Policy (CSP) transformation
 * from Manifest V2 to Manifest V3 format
 */
export class MigrateCSP implements MigrationModule {

    /**
     * Migrates Content Security Policy from MV2 to MV3 format
     * @param extension The extension to migrate CSP for
     * @returns The extension with migrated CSP or a MigrationError
     */
    public static migrate(extension: Extension): Extension | MigrationError {
        try {
            const csp = extension.manifest["content_security_policy"];

            // Default MV3 CSP structure
            const csp_new = {
                "extension_pages": "script-src 'self'; object-src 'self';",
                "sandbox": "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';"
            };

            // If no CSP exists, set the default
            if (!csp) {
                extension.manifest["content_security_policy"] = csp_new;
                logger.info(extension, "No CSP found, using default MV3 CSP");
                return extension;
            }

            // If CSP is already an object (MV3 format), check compliance
            if (typeof csp === 'object') {
                if (MigrateCSP.determineCompliance(csp)) {
                    logger.info(extension, "CSP is already in MV3 format and compliant");
                    return extension;
                } else {
                    // Transform non-compliant MV3 CSP
                    extension.manifest["content_security_policy"] = MigrateCSP.transformCSP(csp);
                    logger.warn(extension, "CSP was in MV3 format but not compliant, transformed to compliant version");
                    return extension;
                }
            }

            // If CSP is a string (MV2 format), check compliance and convert
            if (typeof csp === 'string') {
                if (MigrateCSP.determineCompliance(csp)) {
                    // Compliant string CSP - transform to MV3 object format
                    extension.manifest["content_security_policy"] = {
                        "extension_pages": csp,
                        "sandbox": csp_new.sandbox
                    };
                    logger.info(extension, "Transformed compliant MV2 CSP string to MV3 format");
                    return extension;
                } else {
                    // Non-compliant string CSP - use default compliant CSP
                    extension.manifest["content_security_policy"] = MigrateCSP.transformCSP(csp);
                    logger.warn(extension, "CSP was not compliant, transformed to compliant version");
                    return extension;
                }
            }

            // Unexpected CSP format
            logger.warn(extension, "Unexpected CSP format, using default");
            extension.manifest["content_security_policy"] = csp_new;
            return extension;

        } catch (error) {
            logger.error(extension, 'Failed to migrate CSP', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }



    /**
     * Determines if a CSP is compliant with MV3 requirements
     * @param csp The CSP to check (can be string or object)
     * @returns true if compliant, false otherwise
     */
    private static determineCompliance(csp: string | object): boolean {
        // Handle string CSP (MV2 format)
        if (typeof csp === 'string') {
            return MigrateCSP.isCSPStringCompliant(csp);
        }

        // Handle object CSP (MV3 format)
        if (typeof csp === 'object' && csp !== null) {
            const cspObj = csp as any;

            // Check if extension_pages exists and is compliant
            if (cspObj.extension_pages) {
                if (!MigrateCSP.isCSPStringCompliant(cspObj.extension_pages)) {
                    return false;
                }
            }

            // Sandbox can have unsafe-eval, so it's more permissive
            // We just check if it exists and is a string
            if (cspObj.sandbox && typeof cspObj.sandbox !== 'string') {
                return false;
            }

            return true;
        }

        return false;
    }

    /**
     * Checks if a CSP string is compliant with MV3 requirements
     * @param csp The CSP string to check
     * @returns true if compliant, false otherwise
     */
    private static isCSPStringCompliant(csp: string): boolean {
        // MV3 CSP requirements:
        // 1. Cannot use 'unsafe-eval' (except in sandbox)
        // 2. Cannot use remotely hosted scripts
        // 3. Must use 'self' for script-src
        // 4. object-src must be defined

        const cspLower = csp.toLowerCase();

        // Check for unsafe-eval (not allowed in extension_pages in MV3)
        if (cspLower.includes("'unsafe-eval'")) {
            return false;
        }

        // Check for remotely hosted scripts (http://, https://, or wildcard domains)
        // These patterns indicate remote script sources which are not allowed in MV3
        const remoteScriptPatterns = [
            /script-src[^;]*https?:\/\//i,  // http:// or https:// URLs
            /script-src[^;]*\*\./i,           // Wildcard subdomains like *.example.com
            /script-src[^;]*\*(?!\s|;|$)/i,   // Bare asterisk (but not at end or before whitespace)
        ];

        for (const pattern of remoteScriptPatterns) {
            if (pattern.test(csp)) {
                return false;
            }
        }

        // Check that script-src exists
        if (!cspLower.includes('script-src')) {
            return false;
        }

        // Check that object-src exists
        if (!cspLower.includes('object-src')) {
            return false;
        }

        // Check that script-src includes 'self'
        const scriptSrcMatch = csp.match(/script-src\s+([^;]+)/i);
        if (scriptSrcMatch) {
            const scriptSrcValue = scriptSrcMatch[1].toLowerCase();
            if (!scriptSrcValue.includes("'self'")) {
                return false;
            }
        }

        return true;
    }

    /**
     * Transforms a non-compliant CSP to a compliant MV3 format
     * @param csp The CSP to transform (can be string or object)
     * @returns A compliant MV3 CSP object
     */
    private static transformCSP(csp: string | object): object {
        // Default compliant MV3 CSP
        const compliantCSP = {
            "extension_pages": "script-src 'self'; object-src 'self';",
            "sandbox": "sandbox allow-scripts allow-forms allow-popups allow-modals; script-src 'self' 'unsafe-inline' 'unsafe-eval'; child-src 'self';"
        };

        // TODO: Implement transformation logic
        // This function should:
        // 1. Parse the existing CSP (if string, parse directives; if object, extract values)
        // 2. Remove non-compliant directives (e.g., 'unsafe-eval' from extension_pages)
        // 3. Ensure required directives are present
        // 4. Convert to MV3 object format with extension_pages and sandbox

        return compliantCSP;
    }

}
