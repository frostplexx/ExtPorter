import { Extension } from "../types/extension";
import { MigrationError, MigrationModule } from "../types/migration_module";
import { logger } from "../utils/logger";

export class MigrateManifest implements MigrationModule {


    // taken from https://developer.chrome.com/docs/extensions/reference/permissions-list
    private static readonly API_PERMISSIONS = new Set([
        "accessibilityFeatures.modify",
        "accessibilityFeatures.read",
        "activeTab",
        "alarms",
        "audio",
        "background",
        "bookmarks",
        "browsingData",
        "certificateProvider",
        "clipboardRead",
        "clipboardWrite",
        "contentSettings",
        "contextMenus",
        "cookies",
        "debugger",
        "declarativeContent",
        "declarativeNetRequest",
        "declarativeNetRequestWithHostAccess",
        "declarativeNetRequestFeedback",
        "dns",
        "desktopCapture",
        "documentScan",
        "downloads",
        "downloads.open",
        "downloads.ui",
        "enterprise.deviceAttributes",
        "enterprise.hardwarePlatform",
        "enterprise.networkingAttributes",
        "enterprise.platformKeys",
        "favicon",
        "fileBrowserHandler",
        "fileSystemProvider",
        "fontSettings",
        "gcm",
        "geolocation",
        "history",
        "identity",
        "idle",
        "loginState",
        "management",
        "nativeMessaging",
        "notifications",
        "offscreen",
        "pageCapture",
        "platformKeys",
        "power",
        "printerProvider",
        "printing",
        "printingMetrics",
        "privacy",
        "processes",
        "proxy",
        "readingList",
        "runtime",
        "scripting",
        "search",
        "sessions",
        "sidePanel",
        "storage",
        "system.cpu",
        "system.display",
        "system.memory",
        "system.storage",
        "tabCapture",
        "tabGroups",
        "tabs",
        "topSites",
        "tts",
        "ttsEngine",
        "unlimitedStorage",
        "userScripts",
        "vpnProvider",
        "wallpaper",
        "webAuthenticationProxy",
        "webNavigation",
        "webRequest",
        "webRequestBlocking",
    ]);


    public static migrate(extension: Extension): Extension | MigrationError {
        try {
            // update manfest_version from v2 to v3
            extension.manifest["manifest_version"] = 3

            // split permissions into permissions and host permissions
            const new_permssions = [];
            const host_permission = [];

            const permissions = extension.manifest["permissions"]
            for (const index in permissions) {

                const perm = permissions[index] as string;

                if (perm == undefined) {
                    logger.error(extension, `permission is undefined`);
                } else if (MigrateManifest.API_PERMISSIONS.has(perm)) {

                    //remove webRequestBlocking and set declarativeNetRequest
                    if (perm == "webRequestBlocking") {
                        new_permssions.push("declarativeNetRequest")
                    } else {
                        new_permssions.push(perm)
                    }

                } else {
                    host_permission.push(perm)
                }

            }

            // write back permissions
            extension.manifest["permissions"] = new_permssions;
            extension.manifest["host_permissions"] = host_permission;



            //migrate web_accessible resources
            const resources = extension.manifest["web_accessible_resources"] as string[];
            if (resources != undefined) {
                extension.manifest["web_accessible_resources"] = [{
                    "resources": resources,
                    "matches": [
                        "*://*/*"
                    ]
                }];
            }


            //migrate browser_action and page_action to actions
            const browser_action_obj = extension.manifest["browser_action"];
            const page_action_obj = extension.manifest["page_action"];

            if (browser_action_obj != undefined && page_action_obj != undefined) {
                // Merge both actions into the new action field
                extension.manifest["action"] = { ...browser_action_obj, ...page_action_obj };
            } else if (browser_action_obj != undefined) {
                extension.manifest["action"] = { ...browser_action_obj };
            } else if (page_action_obj != undefined) {
                extension.manifest["action"] = { ...page_action_obj };
            }

            // // Delete the old keys
            delete extension.manifest["browser_action"];
            delete extension.manifest["page_action"];

            //migrate background scripts to service worker
            const background = extension.manifest["background"];
            if (background != undefined) {
                if (background["scripts"] != undefined) {
                    // Convert background.scripts to background.service_worker
                    const scripts = background["scripts"] as string[];
                    if (scripts.length > 0) {
                        // Take the first script as the service worker entry point
                        extension.manifest["background"] = {
                            "service_worker": scripts[0]
                        };

                        // Log if there are multiple scripts that need manual handling
                        if (scripts.length > 1) {
                            logger.warn(extension, `Extension has multiple background scripts. Only using first script '${scripts[0]}' as service worker. Additional scripts`, {
                                "scripts": scripts
                            });
                        }
                    } else {
                        // Empty scripts array - remove background entirely
                        extension.manifest["background"] = {};
                    }
                } else if (background["page"] != undefined) {
                    // Convert background.page to background.service_worker
                    const page = background["page"] as string;
                    extension.manifest["background"] = {
                        "service_worker": page
                    };
                    logger.info(extension, `Extension converted background page to service worker`, {
                        "page": page
                    });
                }

                // Remove persistent field as it's not applicable to service workers
                if (background["persistent"] != undefined) {
                    logger.debug(extension, `Removed persistent field from background for extension`);
                }
            }

            // Add Content Security Policy for MV3
            extension.manifest["content_security_policy"] = {
                "extension_pages": "script-src 'self'; object-src 'self';"
            };

            // logger.debug(extension, JSON.stringify(extension.manifest))

            return extension;
        } catch (error) {
            logger.error(extension, "Failed to migrate manifest", {
                error: error instanceof Error ? error.message : String(error)
            });
            return new MigrationError(extension, error);
        }
    }


}
