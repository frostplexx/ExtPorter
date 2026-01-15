import { Extension } from '../../types/extension';
import { logger } from '../../utils/logger';
import { API_PERMISSIONS } from './permissions';
import { bgScriptChooser } from './background-utils';
import { injectScriptImports } from './script-injector';
import { generateMV3ExtensionId } from './id-generator';
import { extensionUtils } from '../../utils/extension_utils';
import { Tags } from '../../types/tags';
import { MigrationError, MigrationModule } from '../../types/migration_module';

/**
 * Migrates extension manifest from MV2 to MV3 format
 */
export class MigrateManifest implements MigrationModule {
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            // Update manifest_version from v2 to v3
            extension.manifest['manifest_version'] = 3;

            // Generate MV3 extension ID based on manifest content for consistency
            extension.mv3_extension_id = generateMV3ExtensionId(extension);

            // Split permissions into permissions and host permissions
            const { apiPermissions, hostPermissions } = MigrateManifest.splitPermissions(extension);

            // Write back permissions
            extension.manifest['permissions'] = apiPermissions;
            extension.manifest['host_permissions'] = hostPermissions;

            // Add declarativeNetRequest configuration if rules.json exists
            MigrateManifest.addDeclarativeNetRequest(extension);

            // Migrate web_accessible_resources
            MigrateManifest.migrateWebAccessibleResources(extension);

            // Migrate browser_action and page_action to action
            MigrateManifest.migrateActions(extension);

            // Migrate background scripts to service worker
            MigrateManifest.migrateBackground(extension);

            // Add MANIFEST_MIGRATED tag to extension object
            extension = extensionUtils.addTag(extension, Tags.MANIFEST_MIGRATED);



            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to migrate manifest', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    };

    /**
     * Splits permissions into API permissions and host permissions
     */
    static splitPermissions(extension: Extension) {
        const apiPermissions = [];
        const hostPermissions = [];

        const permissions = extension.manifest['permissions'] || [];
        for (const index in permissions) {
            const perm = permissions[index] as string;

            if (perm == undefined) {
                logger.error(extension, `permission is undefined`);
            } else if (API_PERMISSIONS.has(perm)) {
                // Remove webRequestBlocking and set declarativeNetRequest
                if (perm == 'webRequestBlocking') {
                    apiPermissions.push('declarativeNetRequest');
                } else {
                    apiPermissions.push(perm);
                }
            } else {
                hostPermissions.push(perm);
            }
        }

        return { apiPermissions, hostPermissions };
    }

    /**
     * Adds declarativeNetRequest configuration if rules.json exists
     */
    static addDeclarativeNetRequest(extension: Extension): void {
        const hasRulesFile = extension.files.some((file) => file!.path === 'rules.json');
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
    }

    /**
     * Migrates web_accessible_resources to MV3 format
     */
    static migrateWebAccessibleResources(extension: Extension): void {
        const resources = extension.manifest['web_accessible_resources'] as string[];
        if (resources != undefined) {
            extension.manifest['web_accessible_resources'] = [
                {
                    resources: resources,
                    matches: ['*://*/*'],
                },
            ];
        }
    }

    /**
     * Migrates browser_action and page_action to action
     */
    static migrateActions(extension: Extension): void {
        const browser_action_obj = extension.manifest['browser_action'];
        const page_action_obj = extension.manifest['page_action'];

        if (browser_action_obj != undefined && page_action_obj != undefined) {
            // Merge both actions into new action field
            extension.manifest['action'] = {
                ...browser_action_obj,
                ...page_action_obj,
            };
        } else if (browser_action_obj != undefined) {
            extension.manifest['action'] = { ...browser_action_obj };
        } else if (page_action_obj != undefined) {
            extension.manifest['action'] = { ...page_action_obj };
        }

        // Delete old keys
        delete extension.manifest['browser_action'];
        delete extension.manifest['page_action'];
    }

    /**
     * Migrates background scripts to service worker
     */
    static migrateBackground(extension: Extension): void {
        const background = extension.manifest['background'];
        if (background == undefined) {
            return;
        }

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
                    const transformedFile = injectScriptImports(extension, script, scriptsToImport);

                    // Replace the original file with the transformed one in the files array
                    if (transformedFile) {
                        // Explicitly null out old references
                        extension.files = extension.files.map((file) => {
                            if (file != null && file.path === transformedFile.path) {
                                if (file.releaseMemory) file.releaseMemory();
                                file = null; // Help GC
                                return transformedFile;
                            }
                            return file;
                        });
                    }
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
            logger.info(extension, `Extension converted background page to service worker`, {
                page: page,
            });
        }

        // Remove persistent field as it's not applicable to service workers
        if (background['persistent'] != undefined) {
            logger.debug(extension, `Removed persistent field from background for extension`);
        }
    }
}
