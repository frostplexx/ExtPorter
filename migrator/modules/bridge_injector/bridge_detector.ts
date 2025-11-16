import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';

export class BridgeDetector {
    private static readonly CALLBACK_PATTERN =
        /chrome(\.\w+){2,}\((?:.*?,\s*)?(?:function\s*\(|\([^)]*\)\s*=>|\w+\s*(?:\)|,))/;

    /**
     * Checks if an extension likely uses callback-based Chrome APIs
     * by looking for common callback patterns in JavaScript files.
     */
    public static needsBridge(extension: Extension): boolean {
        // Check if any JS files contain callback patterns
        for (const file of extension.files) {
            if (file.filetype === ExtFileType.JS) {
                try {
                    const content = file.getContent();
                    if (content && BridgeDetector.CALLBACK_PATTERN.test(content)) {
                        return true;
                    }
                } catch (error) {
                    // If we can't read the file, skip it and continue
                    logger.warn(
                        extension,
                        `Failed to read file ${file.path} for bridge detection`,
                        error
                    );
                    continue;
                }
            }
        }
        return false;
    }

    /**
     * Helper method for testing - checks if manifest has bridge injected.
     * Note: This only checks manifest-declared scripts. HTML page injections
     * (options_page, popups, etc.) require checking the actual HTML file contents,
     * which this method does not do.
     */
    public static hasBridgeInManifest(manifest: any, bridgeFilename: string): boolean {
        if (!manifest) {
            return false;
        }

        // Check background scripts
        if (manifest.background && manifest.background.scripts) {
            if (manifest.background.scripts.includes(bridgeFilename)) {
                return true;
            }
        }

        // Check content scripts
        if (manifest.content_scripts && Array.isArray(manifest.content_scripts)) {
            return manifest.content_scripts.some(
                (contentScript: any) =>
                    contentScript.js && contentScript.js.includes(bridgeFilename)
            );
        }

        return false;
    }

    /**
     * Helper method to check if an HTML file has the bridge injected.
     * This checks the actual file content, not just the manifest.
     */
    public static hasBridgeInHTML(
        extension: Extension,
        htmlPath: string,
        bridgeFilename: string
    ): boolean {
        const htmlFile = extension.files.find((file) => file.path === htmlPath);

        if (!htmlFile) {
            return false;
        }

        try {
            const content = htmlFile.getContent();
            // Check if the bridge filename appears anywhere in the content
            // (could be with or without relative path)
            return content.includes(bridgeFilename);
        } catch (error) {
            logger.error(extension, error as any);
            return false;
        }
    }
}
