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
            const existingCSP = extension.manifest['content_security_policy'];

            if (typeof existingCSP === 'string') {
                // MV2 format: CSP is a string
                // Validate and convert to MV3 format
                try {
                    const validatedCSP = MigrateCSP.validateAndSanitize(existingCSP);
                    extension.manifest['content_security_policy'] = {
                        extension_pages: validatedCSP,
                    };
                    logger.debug(extension, 'Migrated MV2 CSP to MV3 format', {
                        original: existingCSP,
                        migrated: validatedCSP,
                    });
                } catch (error) {
                    logger.warn(extension, 'Invalid CSP found, using default MV3-compliant CSP', {
                        originalCSP: existingCSP,
                        error: error instanceof Error ? error.message : String(error),
                        reason: 'CSP validation failed - likely contains MV3-incompatible directives',
                    });
                    extension.manifest['content_security_policy'] = {
                        extension_pages: "script-src 'self'; object-src 'self';",
                    };
                }
            } else if (existingCSP && typeof existingCSP === 'object') {
                // Already MV3 format, validate extension_pages if present
                if (existingCSP['extension_pages']) {
                    try {
                        existingCSP['extension_pages'] = MigrateCSP.validateAndSanitize(
                            existingCSP['extension_pages']
                        );
                        logger.debug(extension, 'Validated existing MV3 CSP');
                    } catch (error) {
                        logger.warn(
                            extension,
                            'Invalid extension_pages CSP found, using MV3-compliant default',
                            {
                                originalCSP: existingCSP['extension_pages'],
                                error: error instanceof Error ? error.message : String(error),
                                reason: 'CSP validation failed - likely contains MV3-incompatible directives',
                            }
                        );
                        existingCSP['extension_pages'] = "script-src 'self'; object-src 'self';";
                    }
                } else {
                    // Add missing extension_pages CSP
                    existingCSP['extension_pages'] = "script-src 'self'; object-src 'self';";
                    logger.debug(
                        extension,
                        'Added missing extension_pages CSP to existing MV3 format'
                    );
                }
            } else {
                // No existing CSP, add a safe default for MV3
                extension.manifest['content_security_policy'] = {
                    extension_pages: "script-src 'self'; object-src 'self';",
                };
                logger.debug(extension, 'Added default MV3 CSP (no existing CSP found)');
            }

            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to migrate CSP', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Validates and sanitizes a Content Security Policy string for MV3 compliance
     * @param csp The CSP string to validate
     * @returns A sanitized CSP string
     * @throws Error if CSP is fundamentally invalid
     */
    private static validateAndSanitize(csp: string): string {
        // Basic validation: ensure CSP has required directives
        const normalizedCSP = csp.trim();

        if (!normalizedCSP) {
            throw new Error('Empty CSP');
        }

        // First check if the CSP is MV3 compliant
        if (!MigrateCSP.isMV3Compliant(normalizedCSP)) {
            logger.warn(null, 'CSP contains MV3-incompatible directives, sanitizing', {
                originalCSP: normalizedCSP,
            });
        }

        // Sanitize hash-based directives first
        let sanitizedCSP = MigrateCSP.sanitizeHashDirectives(normalizedCSP);

        // Remove dangerous directives that could break MV3
        logger.debug(null, 'Sanitizing CSP for MV3 compliance', {
            originalCSP: sanitizedCSP,
        });

        // Remove unsafe-eval and unsafe-inline completely
        sanitizedCSP = sanitizedCSP
            .replace(/'unsafe-eval'\s*/g, ' ')
            .replace(/'unsafe-inline'\s*/g, ' ')
            .replace(/\s+data:\s*/g, ' ') // Remove data: URLs
            .replace(/\s+blob:\s*/g, ' ') // Remove blob: URLs
            .replace(/\s+http:\/\/(?!localhost[:/])[^\s;]+/g, ' ') // Remove non-localhost HTTP
            .replace(/\s+(?!https:\/\/)[^\s';][^\s';]*\.js(?=\s|;|$)/g, ' ') // Remove bare .js file paths (not HTTPS URLs)
            .replace(/\s+(?!https:\/\/)[^\s';][^\s';]*\/[^\s';]*\.js(?=\s|;|$)/g, ' ') // Remove paths with slashes to .js files (not HTTPS URLs)
            .replace(/\s+/g, ' ')
            .trim();

        // Early validation - only fall back if CSP is completely malformed
        const hasValidStructure =
            /(?:script-src|style-src|img-src|object-src|default-src|connect-src|font-src|media-src|worker-src|frame-src|manifest-src|base-uri|form-action|frame-ancestors|plugin-types|sandbox|report-uri|report-to)\s+[^;]*;?/.test(
                sanitizedCSP
            );
        if (!hasValidStructure) {
            logger.warn(
                null,
                'CSP has no valid directive structure after sanitization, using safe default'
            );
            return "script-src 'self'; object-src 'self';";
        }

        // Ensure script-src includes 'self' if not present
        if (!sanitizedCSP.includes('script-src')) {
            sanitizedCSP += " script-src 'self';";
        } else if (!sanitizedCSP.includes("script-src 'self'")) {
            sanitizedCSP = sanitizedCSP.replace(/script-src([^;]+);?/, "script-src 'self' $1;");
        }

        // Ensure object-src is restrictive if not present
        if (!sanitizedCSP.includes('object-src')) {
            sanitizedCSP += " object-src 'self';";
        }

        // Clean up extra spaces and ensure proper semicolon termination
        sanitizedCSP = sanitizedCSP.replace(/\s+/g, ' ').replace(/;\s*;/g, ';').trim();
        if (!sanitizedCSP.endsWith(';')) {
            sanitizedCSP += ';';
        }

        // Final check for any remaining critical MV3 violations
        const criticalViolations = [
            /'unsafe-eval'/,
            /'unsafe-inline'/,
            /'sha[0-9]+-[A-Za-z0-9+/]+=*'/,
            /'nonce-[^']+'/,
        ];

        const hasCriticalViolation = criticalViolations.some((pattern) =>
            pattern.test(sanitizedCSP)
        );
        if (hasCriticalViolation) {
            logger.warn(
                null,
                'CSP still contains critical MV3 violations after sanitization, using safe default'
            );
            return "script-src 'self'; object-src 'self';";
        }

        return sanitizedCSP;
    }

    /**
     * Checks if a CSP string is compliant with MV3 security requirements
     * @param csp The CSP string to validate
     * @returns true if the CSP is MV3 compliant
     */
    private static isMV3Compliant(csp: string): boolean {
        // First check if it looks like a valid CSP at all
        const hasValidDirective =
            /(?:script-src|style-src|img-src|object-src|default-src|connect-src|font-src|media-src|worker-src|frame-src|manifest-src|base-uri|form-action|frame-ancestors|plugin-types|sandbox|report-uri|report-to)\s+[^;]*;?/.test(
                csp
            );

        if (!hasValidDirective) {
            return false;
        }

        // Known insecure patterns that Chrome flags in MV3
        const mv3ViolationPatterns = [
            /'unsafe-eval'/,
            /'unsafe-inline'/,
            /'sha[0-9]+-[A-Za-z0-9+/]+=*'/, // Any SHA hash (Chrome flags these as insecure in MV3)
            /'nonce-[^']+'/, // Nonces are generally not recommended for extensions
            /\bdata:/, // Data URLs are generally problematic
            /\bblob:/, // Blob URLs can be problematic
            /\bhttp:\/\/(?!localhost[:/])[^\s;]+/, // Non-localhost HTTP (insecure)
            /\s(?!https:\/\/)[^'\s;][^'\s;]*\.js(?=\s|;|$)/, // Bare JavaScript file paths (not quoted, not HTTPS URLs)
            /\s(?!https:\/\/)[^'\s;][^'\s;]*\/[^'\s;]*\.js(?=\s|;|$)/, // Paths with slashes to JS files (not HTTPS URLs)
        ];

        // Check for any MV3 violations
        return !mv3ViolationPatterns.some((pattern) => pattern.test(csp));
    }

    /**
     * Removes hash-based directives from CSP that are flagged as insecure in MV3
     * @param csp The CSP string to sanitize
     * @returns CSP string with hash directives removed
     */
    private static sanitizeHashDirectives(csp: string): string {
        // List of known insecure patterns (including specific problematic values)
        // FIXME: make this generic
        // TODO: recalculate hashes
        const insecurePatterns = [
            "'sha256-iZBJenro+ON4QTZuWnyvHk3Yj9s/TfHgJLTCP8EJzhE='",
            'remote_resources/f3d11240_ga.js', // Specific file path that causes Chrome MV3 errors
            // Add more known insecure patterns as they're discovered
        ];

        let sanitized = csp;

        // Remove specific known insecure patterns
        insecurePatterns.forEach((pattern) => {
            if (sanitized.includes(pattern)) {
                logger.debug(null, `Removing known insecure pattern: ${pattern}`);
                sanitized = sanitized.replace(
                    new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
                    ''
                );
            }
        });

        // Remove all SHA-based hashes since MV3 prefers external scripts
        const hashPattern = /'sha[0-9]+-[A-Za-z0-9+/]+=*'/g;
        const matches = sanitized.match(hashPattern);
        if (matches) {
            logger.debug(null, `Removing ${matches.length} hash directive(s) for MV3 compliance`, {
                removedHashes: matches,
            });
            sanitized = sanitized.replace(hashPattern, '');
        }

        // Remove nonce directives as well (not recommended for extensions)
        const noncePattern = /'nonce-[^']+'/g;
        const nonceMatches = sanitized.match(noncePattern);
        if (nonceMatches) {
            logger.debug(
                null,
                `Removing ${nonceMatches.length} nonce directive(s) for MV3 compliance`,
                {
                    removedNonces: nonceMatches,
                }
            );
            sanitized = sanitized.replace(noncePattern, '');
        }

        return sanitized;
    }
}
