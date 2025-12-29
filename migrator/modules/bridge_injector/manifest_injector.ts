import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { ServiceWorkerInjector } from './service_worker_injector';
import { HtmlInjector } from './html_injector';
import { logger } from '../../utils/logger';

/**
 * Injects the bridge file into the manifest's script arrays.
 * Modifies extension.files to replace files with transformed versions.
 */
export function injectBridgeIntoManifest(
    manifest: any,
    bridgeFilename: string,
    extension?: Extension
): { updatedManifest: any; transformedFiles: Map<string, LazyFile> } {
    const updatedManifest = JSON.parse(JSON.stringify(manifest));

    // Track transformed files to replace in extension.files
    const transformedFiles: Map<string, LazyFile> = new Map();

    // Inject into background service worker
    if (updatedManifest.background && updatedManifest.background.service_worker) {
        if (extension) {
            const transformedFile = ServiceWorkerInjector.injectBridgeIntoServiceWorker(
                extension,
                updatedManifest.background.service_worker,
                bridgeFilename
            );
            if (transformedFile) {
                transformedFiles.set(transformedFile.path, transformedFile);
                logger.info(extension, 'Bridge successfully injected into service worker');
            } else {
                logger.debug(
                    extension,
                    'No bridge injection needed for service worker (already present or failed)'
                );
            }
        } else {
            logger.warn(
                null,
                'Service worker detected but no extension context provided for bridge injection',
                {
                    service_worker: updatedManifest.background.service_worker,
                }
            );
        }
    }

    // Inject into content scripts
    if (updatedManifest.content_scripts && Array.isArray(updatedManifest.content_scripts)) {
        updatedManifest.content_scripts.forEach((contentScript: any) => {
            if (contentScript.js && Array.isArray(contentScript.js)) {
                if (!contentScript.js.includes(bridgeFilename)) {
                    contentScript.js.unshift(bridgeFilename);
                }
            }
        });
    }

    // Add web_accessible_resources if needed (for content script injection)
    if (updatedManifest.content_scripts && updatedManifest.content_scripts.length > 0) {
        if (!updatedManifest.web_accessible_resources) {
            updatedManifest.web_accessible_resources = [];
        }

        // MV3 format
        if (updatedManifest.manifest_version === 3) {
            const existingResource = updatedManifest.web_accessible_resources.find(
                (resource: any) =>
                    resource.resources && resource.resources.includes(bridgeFilename)
            );

            if (!existingResource) {
                updatedManifest.web_accessible_resources.push({
                    resources: [bridgeFilename],
                    matches: ['<all_urls>'],
                });
            }
        } else {
            // MV2 format (for compatibility during transition)
            if (!updatedManifest.web_accessible_resources.includes(bridgeFilename)) {
                updatedManifest.web_accessible_resources.push(bridgeFilename);
            }
        }
    }

    // Inject into HTML pages
    if (extension) {
        // Inject into options page
        if (updatedManifest.options_page) {
            const transformedFile = HtmlInjector.injectBridgeIntoHTML(
                extension,
                updatedManifest.options_page,
                bridgeFilename
            );
            if (transformedFile) {
                transformedFiles.set(transformedFile.path, transformedFile);
            }
        }

        // Inject into options_ui page
        if (updatedManifest.options_ui?.page) {
            const transformedFile = HtmlInjector.injectBridgeIntoHTML(
                extension,
                updatedManifest.options_ui.page,
                bridgeFilename
            );
            if (transformedFile) {
                transformedFiles.set(transformedFile.path, transformedFile);
            }
        }

        // Inject into action/browser_action/page_action popups
        const popupKeys = ['action', 'browser_action', 'page_action'];
        for (const key of popupKeys) {
            if (updatedManifest[key]?.default_popup) {
                const transformedFile = HtmlInjector.injectBridgeIntoHTML(
                    extension,
                    updatedManifest[key].default_popup,
                    bridgeFilename
                );
                if (transformedFile) {
                    transformedFiles.set(transformedFile.path, transformedFile);
                }
            }
        }

        // Inject into devtools page
        if (updatedManifest.devtools_page) {
            const transformedFile = HtmlInjector.injectBridgeIntoHTML(
                extension,
                updatedManifest.devtools_page,
                bridgeFilename
            );
            if (transformedFile) {
                transformedFiles.set(transformedFile.path, transformedFile);
            }
        }

        // Inject into sidebar action (Firefox)
        if (updatedManifest.sidebar_action?.default_panel) {
            const transformedFile = HtmlInjector.injectBridgeIntoHTML(
                extension,
                updatedManifest.sidebar_action.default_panel,
                bridgeFilename
            );
            if (transformedFile) {
                transformedFiles.set(transformedFile.path, transformedFile);
            }
        }

        // Replace files in `extension.files` with transformed versions
        if (transformedFiles.size > 0) {
            extension.files = extension.files.map((file) =>
                transformedFiles.has(file!.path) ? transformedFiles.get(file!.path)! : file
            );
        }
    }

    return { updatedManifest, transformedFiles };
}
