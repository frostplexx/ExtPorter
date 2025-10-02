import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export class MigrateManifest implements MigrationModule {
    // taken from https://developer.chrome.com/docs/extensions/reference/permissions-list
    private static readonly API_PERMISSIONS = new Set([
        'accessibilityFeatures.modify',
        'accessibilityFeatures.read',
        'activeTab',
        'alarms',
        'audio',
        'background',
        'bookmarks',
        'browsingData',
        'certificateProvider',
        'clipboardRead',
        'clipboardWrite',
        'contentSettings',
        'contextMenus',
        'cookies',
        'debugger',
        'declarativeContent',
        'declarativeNetRequest',
        'declarativeNetRequestWithHostAccess',
        'declarativeNetRequestFeedback',
        'dns',
        'desktopCapture',
        'documentScan',
        'downloads',
        'downloads.open',
        'downloads.ui',
        'enterprise.deviceAttributes',
        'enterprise.hardwarePlatform',
        'enterprise.networkingAttributes',
        'enterprise.platformKeys',
        'favicon',
        'fileBrowserHandler',
        'fileSystemProvider',
        'fontSettings',
        'gcm',
        'geolocation',
        'history',
        'identity',
        'idle',
        'loginState',
        'management',
        'nativeMessaging',
        'notifications',
        'offscreen',
        'pageCapture',
        'platformKeys',
        'power',
        'printerProvider',
        'printing',
        'printingMetrics',
        'privacy',
        'processes',
        'proxy',
        'readingList',
        'runtime',
        'scripting',
        'search',
        'sessions',
        'sidePanel',
        'storage',
        'system.cpu',
        'system.display',
        'system.memory',
        'system.storage',
        'tabCapture',
        'tabGroups',
        'tabs',
        'topSites',
        'tts',
        'ttsEngine',
        'unlimitedStorage',
        'userScripts',
        'vpnProvider',
        'wallpaper',
        'webAuthenticationProxy',
        'webNavigation',
        'webRequest',
        'webRequestBlocking',
    ]);

    public static migrate(extension: Extension): Extension | MigrationError {
        try {
            // update manfest_version from v2 to v3
            extension.manifest['manifest_version'] = 3;

            // Generate MV3 extension ID based on manifest content for consistency
            extension.mv3_extension_id = MigrateManifest.generateMV3ExtensionId(extension);

            // split permissions into permissions and host permissions
            const new_permssions = [];
            const host_permission = [];

            const permissions = extension.manifest['permissions'];
            for (const index in permissions) {
                const perm = permissions[index] as string;

                if (perm == undefined) {
                    logger.error(extension, `permission is undefined`);
                } else if (MigrateManifest.API_PERMISSIONS.has(perm)) {
                    //remove webRequestBlocking and set declarativeNetRequest
                    if (perm == 'webRequestBlocking') {
                        new_permssions.push('declarativeNetRequest');
                    } else {
                        new_permssions.push(perm);
                    }
                } else {
                    host_permission.push(perm);
                }
            }

            // write back permissions
            extension.manifest['permissions'] = new_permssions;
            extension.manifest['host_permissions'] = host_permission;

            //migrate web_accessible resources
            const resources = extension.manifest['web_accessible_resources'] as string[];
            if (resources != undefined) {
                extension.manifest['web_accessible_resources'] = [
                    {
                        resources: resources,
                        matches: ['*://*/*'],
                    },
                ];
            }

            //migrate browser_action and page_action to actions
            const browser_action_obj = extension.manifest['browser_action'];
            const page_action_obj = extension.manifest['page_action'];

            if (browser_action_obj != undefined && page_action_obj != undefined) {
                // Merge both actions into the new action field
                extension.manifest['action'] = {
                    ...browser_action_obj,
                    ...page_action_obj,
                };
            } else if (browser_action_obj != undefined) {
                extension.manifest['action'] = { ...browser_action_obj };
            } else if (page_action_obj != undefined) {
                extension.manifest['action'] = { ...page_action_obj };
            }

            // // Delete the old keys
            delete extension.manifest['browser_action'];
            delete extension.manifest['page_action'];

            //migrate background scripts to service worker
            const background = extension.manifest['background'];
            if (background != undefined) {
                if (background['scripts'] != undefined) {
                    // Convert background.scripts to background.service_worker
                    const scripts = background['scripts'] as string[];
                    if (scripts.length > 0) {
                        // Take the first script as the service worker entry point
                        extension.manifest['background'] = {
                            service_worker: scripts[0],
                        };

                        // Log if there are multiple scripts that need manual handling
                        if (scripts.length > 1) {
                            logger.warn(
                                extension,
                                `Extension has multiple background scripts. Only using first script '${scripts[0]}' as service worker. Additional scripts`,
                                {
                                    scripts: scripts,
                                }
                            );
                        }
                    } else {
                        // Empty scripts array - remove background entirely
                        extension.manifest['background'] = {};
                    }
                } else if (background['page'] != undefined) {
                    // Convert background.page to background.service_worker
                    const page = background['page'] as string;
                    extension.manifest['background'] = {
                        service_worker: page,
                    };
                    logger.info(
                        extension,
                        `Extension converted background page to service worker`,
                        {
                            page: page,
                        }
                    );
                }

                // Remove persistent field as it's not applicable to service workers
                if (background['persistent'] != undefined) {
                    logger.debug(
                        extension,
                        `Removed persistent field from background for extension`
                    );
                }
            }

            // Handle Content Security Policy migration from MV2 to MV3
            MigrateManifest.migrateContentSecurityPolicy(extension);

            // logger.debug(extension, JSON.stringify(extension.manifest))

            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to migrate manifest', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Generates a consistent MV3 extension ID based on extension name and original ID
     * @param extension The extension to generate an ID for
     * @returns A 32-character lowercase extension ID
     */
    private static generateMV3ExtensionId(extension: Extension): string {
        // Use extension name + original ID to ensure uniqueness and consistency
        const seedData = `${extension.name}-${extension.id}-mv3`;

        return crypto
            .createHash('sha256')
            .update(seedData)
            .digest('hex')
            .substring(0, 32)
            .replace(/./g, (c: any) => String.fromCharCode(97 + (parseInt(c, 16) % 26)));
    }

    /**
     * Migrates Content Security Policy from MV2 to MV3 format
     * @param extension The extension to migrate CSP for
     */
    private static migrateContentSecurityPolicy(extension: Extension): void {
        const existingCSP = extension.manifest['content_security_policy'];

        if (typeof existingCSP === 'string') {
            // MV2 format: CSP is a string
            // Validate and convert to MV3 format
            try {
                const validatedCSP = MigrateManifest.validateAndSanitizeCSP(existingCSP);
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
                    existingCSP['extension_pages'] = MigrateManifest.validateAndSanitizeCSP(
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
                logger.debug(extension, 'Added missing extension_pages CSP to existing MV3 format');
            }
        } else {
            // No existing CSP, add a safe default for MV3
            extension.manifest['content_security_policy'] = {
                extension_pages: "script-src 'self'; object-src 'self';",
            };
            logger.debug(extension, 'Added default MV3 CSP (no existing CSP found)');
        }
    }

    /**
     * Validates and sanitizes a Content Security Policy string for MV3 compliance
     * @param csp The CSP string to validate
     * @returns A sanitized CSP string
     * @throws Error if CSP is fundamentally invalid
     */
    private static validateAndSanitizeCSP(csp: string): string {
        // Basic validation: ensure CSP has required directives
        const normalizedCSP = csp.trim();

        if (!normalizedCSP) {
            throw new Error('Empty CSP');
        }

        // First check if the CSP is MV3 compliant
        if (!MigrateManifest.isMV3CompliantCSP(normalizedCSP)) {
            logger.warn(null, 'CSP contains MV3-incompatible directives, sanitizing', {
                originalCSP: normalizedCSP,
            });
        }

        // Sanitize hash-based directives first
        let sanitizedCSP = MigrateManifest.sanitizeHashDirectives(normalizedCSP);

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
    private static isMV3CompliantCSP(csp: string): boolean {
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
