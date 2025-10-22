import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { logger } from '../utils/logger';
import { Tags } from '../types/tags';
import { ExtFileType } from '../types/ext_file_types';

// Configuration weights similar to extension_analyzer.py
const WEIGHTS = {
    webRequest: 25, // +25 per webRequest occurrence
    html_lines: 0.25, // +0.25 per line of HTML
    storage_local: 5, // +5 per storage.local occurrence
    background_page: 10, // +10 if has background page/service worker
    content_scripts: 4, // +4 if has content scripts
    dangerous_permissions: 8, // +8 per dangerous permission (tabs, cookies, history, etc.)
    host_permissions: 3, // +3 per external host permission
    crypto_patterns: 15, // +15 per crypto/obfuscation pattern (eval, Function, btoa, etc.)
    network_requests: 2, // +2 per network request pattern (fetch, XMLHttpRequest, etc.)
    extension_size: 1, // +1 per 100KB of extension size

    // Migration-specific weights
    api_renames: 10, // +10 per API rename detected
    manifest_changes: 5, // +5 per manifest field change
    file_modifications: 2, // +2 per modified file
    webRequest_to_dnr_migrations: 20, // +20 per webRequest to DNR migration
};

interface InterestingnessBreakdown {
    webRequest: number;
    html_lines: number;
    storage_local: number;
    background_page: number;
    content_scripts: number;
    dangerous_permissions: number;
    host_permissions: number;
    crypto_patterns: number;
    network_requests: number;
    extension_size: number;
    api_renames: number;
    manifest_changes: number;
    file_modifications: number;
    webRequest_to_dnr_migrations: number;
}

export class InterestingnessScorer implements MigrationModule {
    private static readonly DANGEROUS_PERMISSIONS = new Set([
        'tabs',
        'activeTab',
        'cookies',
        'history',
        'bookmarks',
        'management',
        'privacy',
        'proxy',
        'downloads',
        'nativeMessaging',
        'webRequest',
        'webRequestBlocking',
        'declarativeNetRequest',
    ]);

    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            const score = InterestingnessScorer.calculateInterestingnessScore(extension);

            // Add score to extension
            (extension as any).interestingness_score = score.total;
            (extension as any).interestingness_breakdown = score.breakdown;

            logger.debug(extension, `Calculated interestingness score: ${score.total}`, {
                breakdown: score.breakdown,
            });

            // Add feature/characteristic tags based on the analysis
            await InterestingnessScorer.addFeatureTags(extension, score.breakdown);

            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to calculate interestingness score', {
                error,
            });
            return new MigrationError(extension, error);
        }
    }

    private static calculateInterestingnessScore(extension: Extension): {
        total: number;
        breakdown: InterestingnessBreakdown;
    } {
        const scores: InterestingnessBreakdown = {
            webRequest: 0,
            html_lines: 0,
            storage_local: 0,
            background_page: 0,
            content_scripts: 0,
            dangerous_permissions: 0,
            host_permissions: 0,
            crypto_patterns: 0,
            network_requests: 0,
            extension_size: 0,
            api_renames: 0,
            manifest_changes: 0,
            file_modifications: 0,
            webRequest_to_dnr_migrations: 0,
        };

        // Analyze extension files for patterns
        InterestingnessScorer.analyzeFiles(extension, scores);

        // Analyze manifest for permissions and structure
        InterestingnessScorer.analyzeManifest(extension, scores);

        // Calculate extension size
        InterestingnessScorer.calculateExtensionSize(extension, scores);

        // Analyze migration-specific changes (if available)
        InterestingnessScorer.analyzeMigrationChanges(extension, scores);

        // Check if a webRequest to DNR migration was performed during this run
        if ((extension as any).metrics?.webRequest_to_dnr_migrations) {
            scores.webRequest_to_dnr_migrations = 1;
        }

        const total = Object.entries(scores).reduce((sum, [key, value]) => {
            return sum + value * WEIGHTS[key as keyof typeof WEIGHTS];
        }, 0);

        return { total: Math.round(total), breakdown: scores };
    }

    private static analyzeFiles(extension: Extension, scores: InterestingnessBreakdown): void {
        let totalHtmlLines = 0;
        let webRequestCount = 0;
        let storageLocalCount = 0;
        let cryptoPatternCount = 0;
        let networkRequestCount = 0;

        for (const file of extension.files) {
            try {
                const content = file.getContent();

                // Count HTML lines
                if (file.filetype === ExtFileType.HTML) {
                    totalHtmlLines += content.split('\n').length;
                }

                // Search for patterns in JS files
                if (file.filetype === ExtFileType.JS) {
                    // webRequest patterns
                    webRequestCount += InterestingnessScorer.countPattern(content, /webRequest/g);

                    // storage.local patterns
                    storageLocalCount += InterestingnessScorer.countPattern(
                        content,
                        /storage\.local/g
                    );

                    // Crypto/obfuscation patterns
                    const cryptoPatterns = [
                        /eval\(/g,
                        /Function\(/g,
                        /btoa\(/g,
                        /atob\(/g,
                        /crypto\./g,
                    ];
                    cryptoPatternCount += cryptoPatterns.reduce(
                        (sum, pattern) =>
                            sum + InterestingnessScorer.countPattern(content, pattern),
                        0
                    );

                    // Network request patterns
                    const networkPatterns = [/fetch\(/g, /XMLHttpRequest/g, /\.ajax\(/g];
                    networkRequestCount += networkPatterns.reduce(
                        (sum, pattern) =>
                            sum + InterestingnessScorer.countPattern(content, pattern),
                        0
                    );
                }
            } catch (error) {
                logger.debug(extension, `Error analyzing file ${file.path}`, { error });
            }
        }

        scores.html_lines = totalHtmlLines;
        scores.webRequest = webRequestCount;
        scores.storage_local = storageLocalCount;
        scores.crypto_patterns = cryptoPatternCount;
        scores.network_requests = networkRequestCount;
    }

    private static analyzeManifest(extension: Extension, scores: InterestingnessBreakdown): void {
        const manifest = extension.manifest;

        if (!manifest) return;

        // Check for background page/service worker
        if (manifest.background || manifest.service_worker) {
            scores.background_page = 1;
        }

        // Check for content scripts
        if (
            manifest.content_scripts &&
            Array.isArray(manifest.content_scripts) &&
            manifest.content_scripts.length > 0
        ) {
            scores.content_scripts = 1;
        }

        // Count dangerous permissions
        const permissions = manifest.permissions || [];
        scores.dangerous_permissions = permissions.filter((perm: string) =>
            InterestingnessScorer.DANGEROUS_PERMISSIONS.has(perm)
        ).length;

        // Count host permissions
        let hostPermissionCount = 0;

        // Manifest v2 host permissions (in permissions array)
        for (const perm of permissions) {
            if (typeof perm === 'string' && (perm.includes('://') || perm.startsWith('*'))) {
                hostPermissionCount++;
            }
        }

        // Manifest v3 host permissions
        const hostPermissions = manifest.host_permissions || [];
        hostPermissionCount += hostPermissions.length;

        scores.host_permissions = hostPermissionCount;
    }

    private static calculateExtensionSize(
        extension: Extension,
        scores: InterestingnessBreakdown
    ): void {
        let totalSize = 0;

        for (const file of extension.files) {
            try {
                if (file.filetype === ExtFileType.OTHER) {
                    // For binary files, estimate size from buffer
                    totalSize += file.getBuffer().length;
                } else {
                    // For text files, calculate size from content
                    totalSize += Buffer.byteLength(file.getContent(), 'utf8');
                }
            } catch (error) {
                logger.debug(extension, `Error calculating size for file ${file.path}`, { error });
            }
        }

        // Add manifest size
        if (extension.manifest) {
            totalSize += Buffer.byteLength(JSON.stringify(extension.manifest), 'utf8');
        }

        // Convert to KB and calculate score (per 100KB)
        const sizeKB = totalSize / 1024;
        scores.extension_size = Math.floor(sizeKB / 100);
    }

    private static analyzeMigrationChanges(
        extension: Extension,
        scores: InterestingnessBreakdown
    ): void {
        // This is where we could analyze migration-specific changes
        // For now, we'll implement basic heuristics based on manifest version

        if (extension.manifest) {
            // If extension has both MV2 and MV3 IDs, it indicates migration happened
            if (extension.mv3_extension_id && extension.mv3_extension_id !== extension.id) {
                scores.manifest_changes += 1; // Base score for manifest migration
            }

            // Check for manifest version upgrade
            if (extension.manifest.manifest_version === 3) {
                scores.manifest_changes += 2; // Additional score for MV3 conversion

                // MV3 specific migrations likely happened
                if (extension.manifest.action || extension.manifest.host_permissions) {
                    scores.api_renames += 1;
                }

                if (extension.manifest.background?.service_worker) {
                    scores.api_renames += 2; // Background script to service worker conversion
                }
            }
        }

        // Estimate file modifications based on presence of common migration patterns
        let modifiedFileCount = 0;
        for (const file of extension.files) {
            if (file.filetype === ExtFileType.JS) {
                try {
                    const content = file.getContent();
                    // Look for common migration patterns that suggest the file was modified
                    if (
                        content.includes('chrome.action') ||
                        content.includes('chrome.scripting') ||
                        content.includes('declarativeNetRequest')
                    ) {
                        modifiedFileCount++;
                    }
                } catch {
                    // Ignore errors in content analysis
                }
            }
        }

        scores.file_modifications = modifiedFileCount;
    }

    private static countPattern(content: string, pattern: RegExp): number {
        const matches = content.match(pattern);
        return matches ? matches.length : 0;
    }

    /**
     * Adds feature/characteristic tags based on the interestingness breakdown
     */
    private static async addFeatureTags(extension: Extension, breakdown: InterestingnessBreakdown): Promise<void> {
        const manifest = extension.manifest;

        // Initialize tags array if it doesn't exist
        if (!extension.tags) {
            extension.tags = [];
        }

        const addTag = (tag: Tags) => {
            const tagName = Tags[tag];  // Convert enum value to string name
            if (!extension.tags!.includes(tagName)) {
                extension.tags!.push(tagName);
            }
        };

        // Extension Features
        if (manifest?.action || manifest?.browser_action || manifest?.page_action) {
            addTag(Tags.HAS_BROWSER_POPUP);
        }

        if (breakdown.background_page > 0) {
            addTag(Tags.HAS_BACKGROUND_PAGE);
        }

        if (breakdown.content_scripts > 0) {
            addTag(Tags.HAS_CONTENT_SCRIPTS);
        }

        if (manifest?.background?.service_worker) {
            addTag(Tags.HAS_SERVICE_WORKER);
        }

        if (manifest?.chrome_url_overrides?.newtab) {
            addTag(Tags.NEW_TAB_OVERRIDE);
        }

        // Permission Categories
        if (breakdown.host_permissions > 0) {
            addTag(Tags.HAS_HOST_PERMISSIONS);
        }

        if (breakdown.webRequest > 0) {
            addTag(Tags.USES_WEB_REQUEST);
        }

        if (breakdown.storage_local > 0) {
            addTag(Tags.USES_STORAGE_LOCAL);
        }

        // Check for tabs API usage
        const permissions = manifest?.permissions || [];
        if (permissions.includes('tabs') || permissions.includes('activeTab')) {
            addTag(Tags.USES_TABS_API);
        }

        // Code Characteristics
        // Detect webpack bundles
        let hasWebpack = false;
        let hasEval = false;
        let hasMinified = false;

        for (const file of extension.files) {
            if (file.filetype === ExtFileType.JS) {
                try {
                    const content = file.getContent();

                    // Check for webpack
                    if (content.includes('__webpack_require__') ||
                        content.includes('webpackChunk') ||
                        /\(\d+,\s*function\s*\(\s*\w+,\s*\w+,\s*\w+\s*\)/.test(content.substring(0, 10000))) {
                        hasWebpack = true;
                    }

                    // Check for eval
                    if (/eval\(/.test(content)) {
                        hasEval = true;
                    }

                    // Check for minified code (long lines without spaces)
                    const lines = content.split('\n');
                    for (const line of lines) {
                        if (line.length > 500 && line.split(' ').length < line.length / 20) {
                            hasMinified = true;
                            break;
                        }
                    }
                } catch (error) {
                    logger.error(extension, `${error}`);
                    // Skip files that can't be read
                }
            }
        }

        if (hasWebpack) {
            addTag(Tags.WEBPACK_BUNDLED);
        }

        if (hasEval) {
            addTag(Tags.CONTAINS_EVAL);
        }

        if (hasMinified) {
            addTag(Tags.MINIFIED_CODE);
        }
    }
}
