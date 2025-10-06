import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger";

interface BlacklistPattern {
    pattern: string;
    reason: string;
    case_sensitive: boolean;
}

interface BlacklistConfig {
    description: string;
    blacklist_patterns: BlacklistPattern[];
    settings: {
        log_blacklisted_files: boolean;
        count_blacklisted_in_stats: boolean;
    };
}

/**
 * Utility class for checking if files should be excluded from transformation
 * based on configurable regex patterns (libraries, minified files, etc.)
 */
export class BlacklistChecker {
    private static instance: BlacklistChecker;
    private static MAX_FILE_SIZE = 10000;
    private config: BlacklistConfig | null = null;
    private compiledPatterns: { regex: RegExp; reason: string }[] = [];

    private constructor() { }

    public static getInstance(): BlacklistChecker {
        if (!BlacklistChecker.instance) {
            BlacklistChecker.instance = new BlacklistChecker();
        }
        return BlacklistChecker.instance;
    }

    /**
     * Load blacklist configuration from file
     */
    private loadConfig(): BlacklistConfig {
        if (this.config !== null) {
            return this.config;
        }

        try {
            const configPath = path.join(__dirname, "../templates/transformation_blacklist.json");
            logger.debug(null, "Loading transformation blacklist", { path: configPath });

            const fileContent = fs.readFileSync(configPath, "utf8");
            this.config = JSON.parse(fileContent);

            // Compile regex patterns for performance
            this.compiledPatterns = this.config!.blacklist_patterns.map(pattern => ({
                regex: new RegExp(pattern.pattern, pattern.case_sensitive ? '' : 'i'),
                reason: pattern.reason
            }));

            logger.debug(null, "Transformation blacklist loaded", {
                patternCount: this.config!.blacklist_patterns.length
            });

        } catch (error) {
            logger.error(null, "Failed to load transformation blacklist", {
                error: error instanceof Error ? error.message : String(error)
            });

            // Fallback to empty config to prevent crashes
            this.config = {
                description: "Fallback empty config",
                blacklist_patterns: [],
                settings: {
                    log_blacklisted_files: false,
                    count_blacklisted_in_stats: false
                }
            };
            this.compiledPatterns = [];
        }

        return this.config!;
    }

    /**
     * Check if a file path should be blacklisted from transformation
     * @param filePath The file path to check
     * @param fileContent Optional file content for signature-based detection
     * @returns Object with isBlacklisted boolean and reason string
     */
    public isFileBlacklisted(filePath: string, fileContent?: string): { isBlacklisted: boolean; reason?: string } {
        const config = this.loadConfig();

        // Normalize file path for consistent matching
        const normalizedPath = filePath.replace(/\\/g, '/');

        // First check filename patterns
        for (const { regex, reason } of this.compiledPatterns) {
            if (regex.test(normalizedPath)) {
                if (config.settings.log_blacklisted_files) {
                    logger.debug(null, "File blacklisted from transformation", {
                        filePath: normalizedPath,
                        reason: reason,
                        pattern: regex.source
                    });
                }
                return { isBlacklisted: true, reason };
            }
        }

        // If file content is provided, check for webpack signatures
        if (fileContent && this.isWebpackBundle(fileContent)) {
            const reason = "File contains webpack bundle signatures and should not be transformed";
            if (config.settings.log_blacklisted_files) {
                logger.debug(null, "File blacklisted by webpack signature detection", {
                    filePath: normalizedPath,
                    reason: reason,
                    detectionType: "content-signature"
                });
            }
            return { isBlacklisted: true, reason };
        }

        return { isBlacklisted: false };
    }

    /**
     * Get statistics about blacklisted patterns
     */
    public getBlacklistStats(): {
        totalPatterns: number;
        settings: { log_blacklisted_files: boolean; count_blacklisted_in_stats: boolean };
    } {
        const config = this.loadConfig();
        return {
            totalPatterns: config.blacklist_patterns.length,
            settings: config.settings
        };
    }

    /**
     * Add a runtime pattern to the blacklist (useful for testing)
     */
    public addRuntimePattern(pattern: string, reason: string, caseSensitive: boolean = false): void {
        const regex = new RegExp(pattern, caseSensitive ? '' : 'i');
        this.compiledPatterns.push({ regex, reason });

        logger.debug(null, "Runtime blacklist pattern added", {
            pattern,
            reason,
            caseSensitive
        });
    }

    /**
     * Clear all runtime patterns (keeps file-based patterns)
     */
    public clearRuntimePatterns(): void {
        const config = this.loadConfig();
        this.compiledPatterns = config.blacklist_patterns.map(pattern => ({
            regex: new RegExp(pattern.pattern, pattern.case_sensitive ? '' : 'i'),
            reason: pattern.reason
        }));

        logger.debug(null, "Runtime blacklist patterns cleared");
    }

    /**
     * Detect if file content contains webpack bundle signatures
     * @param content File content to analyze
     * @returns True if webpack signatures are detected
     */
    private isWebpackBundle(content: string): boolean {
        // Performance optimization: only check first 10KB for signatures
        const contentToCheck = content.substring(0, BlacklistChecker.MAX_FILE_SIZE);

        // Common webpack signatures
        const webpackSignatures = [
            // Webpack runtime functions
            '__webpack_require__',
            '__webpack_modules__',
            '__webpack_module_cache__',
            '__webpack_require__.cache',

            // Webpack chunk loading
            '__webpack_require__.e',
            '__webpack_require__.f',
            'webpackChunkName',
            'webpackChunk',

            // Module systems
            '__webpack_require__.d',  // define getter
            '__webpack_require__.o',  // object prototype hasOwnProperty
            '__webpack_require__.r',  // define __esModule
            '__webpack_require__.n',  // getDefaultExport

            // Common webpack runtime patterns
            'window["webpackJsonp"]',
            'self["webpackChunk"]',
            '/******/ (function()',
            '/******/ (() => {',

            // Webpack manifest and hot module replacement
            '__webpack_require__.hmrF',
            '__webpack_require__.hmrC',
            'webpackHotUpdate',

            // Minified webpack patterns (often in production builds)
            ')&&(this||self)[',
            '("number"==typeof __webpack_require__)',
            '.push([['
        ];

        // Check for multiple signatures to reduce false positives
        let signatureCount = 0;
        for (const signature of webpackSignatures) {
            if (contentToCheck.includes(signature)) {
                signatureCount++;
                // If we find 2+ signatures, it's very likely a webpack bundle
                if (signatureCount >= 2) {
                    return true;
                }
            }
        }

        // Additional checks for common webpack bundle patterns
        if (signatureCount >= 1) {
            // Look for module definition patterns common in webpack
            const modulePatterns = [
                /\(\d+,\s*function\s*\(\s*\w+,\s*\w+,\s*\w+\s*\)/,  // (123, function(e, t, n))
                /\[\d+\]:\s*function\s*\(\s*\w+,\s*\w+,\s*\w+\s*\)/, // [123]: function(e, t, n)
                /module\.exports\s*=\s*__webpack_require__/,         // CommonJS exports
                /Object\.defineProperty\(\w+,\s*"__esModule"/        // ES module marker
            ];

            for (const pattern of modulePatterns) {
                if (pattern.test(contentToCheck)) {
                    return true;
                }
            }
        }

        return false;
    }
}
