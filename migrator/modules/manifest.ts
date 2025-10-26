import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { logger } from '../utils/logger';
import { Tags } from '../types/tags';
import crypto from 'crypto';
import { FileContentUpdater } from '../utils/file_content_updater';

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

    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
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

            // Add declarativeNetRequest configuration if rules.json exists
            const hasRulesFile = extension.files.some((file) => file.path === 'rules.json');
            if (hasRulesFile) {
                // Merge with existing declarative_net_request if present
                const dnr = extension.manifest['declarative_net_request'] ?? { rule_resources: [] };
                // Ensure rule_resources is an array
                dnr.rule_resources = Array.isArray(dnr.rule_resources) ? dnr.rule_resources : [];
                // Check if rules.json is already present
                const hasRuleset = dnr.rule_resources.some((r: any) => r.path === 'rules.json');
                if (!hasRuleset) {
                    // Generate a unique id for the new ruleset
                    let id = 'ruleset_1';
                    const existingIds = new Set(dnr.rule_resources.map((r: any) => r.id));
                    let counter = 1;
                    while (existingIds.has(id)) {
                        counter++;
                        id = `ruleset_${counter}`;
                    }
                    dnr.rule_resources.push({
                        id,
                        enabled: true,
                        path: 'rules.json',
                    });
                    extension.manifest['declarative_net_request'] = dnr;
                    logger.info(extension, 'Added declarativeNetRequest configuration to manifest');
                }
            }

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

                        if (scripts.length > 1) {

                            const script = bgScriptChooser(scripts);
                            logger.warn(
                                extension,
                                `Extension has multiple background scripts. Picking '${script}' as service worker`,
                                {
                                    picked_script: script,
                                    scripts: scripts,
                                }
                            );
                            extension.manifest['background'] = {
                                service_worker: script,
                            };

                            // Get all other scripts in their original order (excluding the chosen one)
                            const scriptsToImport = scripts.filter((s) => s !== script);

                            // Inject importScripts() calls into the chosen service worker
                            MigrateManifest.injectScriptImports(extension, script, scriptsToImport);
                        } else {
                            extension.manifest['background'] = {
                                service_worker: scripts[0],
                            };
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

            // logger.debug(extension, JSON.stringify(extension.manifest))

            // Add MANIFEST_MIGRATED tag to extension object
            if (!extension.tags) {
                extension.tags = [];
            }
            const manifestTag = Tags[Tags.MANIFEST_MIGRATED];
            if (!extension.tags.includes(manifestTag)) {
                extension.tags.push(manifestTag);
            }

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
     * Injects importScripts() calls into the chosen service worker for all other background scripts
     * @param extension The extension being migrated
     * @param serviceWorkerPath The path to the chosen service worker
     * @param scriptsToImport Array of script paths to import (excluding the service worker itself)
     */
    private static injectScriptImports(
        extension: Extension,
        serviceWorkerPath: string,
        scriptsToImport: string[]
    ): void {
        if (scriptsToImport.length === 0) {
            return;
        }

        // Find the service worker file in the extension
        const serviceWorkerFile = extension.files.find((file) => file.path === serviceWorkerPath);

        if (!serviceWorkerFile) {
            logger.warn(
                extension,
                `Service worker file not found: ${serviceWorkerPath}. Cannot inject imports.`
            );
            return;
        }

        try {
            // Get the current content
            const currentContent = serviceWorkerFile.getContent();

            // Build the import statements for all other scripts in their original order
            const importStatements = scriptsToImport
                .map((script) => `importScripts('${script}');`)
                .join('\n');

            // Prepend import statements to the beginning of the file
            const newContent = `${importStatements}\n${currentContent}`;

            // Update the file content
            FileContentUpdater.updateFileContent(serviceWorkerFile, newContent);

            logger.info(
                extension,
                `Injected importScripts() into service worker: ${serviceWorkerPath}`,
                {
                    imported_scripts: scriptsToImport,
                }
            );
        } catch (error) {
            logger.error(
                extension,
                `Failed to inject imports into service worker ${serviceWorkerPath}: ${error instanceof Error ? error.message : String(error)}`,
                {
                    error:
                        error instanceof Error
                            ? {
                                message: error.message,
                                stack: error.stack,
                                name: error.name,
                            }
                            : String(error),
                }
            );
        }
    }
}

// Define scoring rules as a map with regex patterns for background script selection
const BG_SCRIPT_SCORE_MAP = new Map<RegExp, number>([
    // High priority - likely background scripts
    [/\bbackground(script)?\b/i, 15],
    [/\bbg\b/i, 10],
    [/\bworker\b/i, 12],
    [/\bservice[-_]?worker\b/i, 13],
    [/\bmain\b/i, 8],
    [/\bindex\b/i, 6],
    [/\binit\b/i, 7],
    [/\bcore\b/i, 5],

    // Medium priority - supporting files
    [/\bsrc\b/i, 4],
    [/\bscript\b/i, 3],
    [/\bapp\b/i, 3],
    [/\brun\b/i, 3],

    // Low priority - less likely to be background
    [/\butil(s|ity|ities)?\b/i, -3],
    [/\bhelper(s)?\b/i, -3],
    [/\bcommon\b/i, -2],
    [/\bshared\b/i, -2],
    [/\bconfig\b/i, -4],

    // Very low priority - definitely not background
    [/\bjquery\b/i, -10],
    [/\blib(rary|s)?\b/i, -10],
    [/\bvendor\b/i, -8],
    [/\bthird[-_]?party\b/i, -8],
    [/\bdeps?\b/i, -6],
    [/\bdependenc(y|ies)\b/i, -6],
    [/\bnode_modules\b/i, -12],
    [/\btest(s)?\b/i, -15],
    [/\bspec\b/i, -15],
    [/\bmock(s)?\b/i, -12],
    [/\bdemo\b/i, -10],
    [/\bexample(s)?\b/i, -10]
]);

// Pre-calculate max possible score for early return optimization
const BG_SCRIPT_MAX_SCORE = Array.from(BG_SCRIPT_SCORE_MAP.values())
    .filter(v => v > 0)
    .reduce((a, b) => a + b, 0);

/**
 * Pick the correct background script based on some heuristics
 * @param scripts Array of scripts
 * @returns The name of the chosen background script
 */
function bgScriptChooser(scripts: string[]): string {
    if (scripts.length === 0) {
        throw new Error('No scripts provided');
    }

    if (scripts.length === 1) {
        return scripts[0];
    }

    let bestScript = scripts[0];
    let bestScore = calculateScore(scripts[0], BG_SCRIPT_SCORE_MAP);

    if (bestScore >= BG_SCRIPT_MAX_SCORE) return bestScript;

    for (let i = 1; i < scripts.length; i++) {
        const score = calculateScore(scripts[i], BG_SCRIPT_SCORE_MAP);

        if (score > bestScore) {
            bestScore = score;
            bestScript = scripts[i];

            if (score >= BG_SCRIPT_MAX_SCORE) return bestScript;
        }
    }

    return bestScript;
}

function calculateScore(script: string, scoreMap: Map<RegExp, number>): number {
    let score = 0;

    for (const [pattern, points] of scoreMap) {
        if (pattern.test(script)) {
            score += points;
        }
    }

    return score;
}
