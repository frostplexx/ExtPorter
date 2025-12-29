import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { logger } from '../../utils/logger';
import { Tags } from '../../types/tags';
import { InterestingnessBreakdown } from './scoring-config';

/**
 * Feature tagging utilities based on extension analysis
 */
export class FeatureTagger {
    /**
     * Adds feature/characteristic tags based on interestingness breakdown
     */
    static async addFeatureTags(
        extension: Extension,
        breakdown: InterestingnessBreakdown
    ): Promise<void> {
        const manifest = extension.manifest;

        // Initialize tags array if it doesn't exist
        if (!extension.tags) {
            extension.tags = [];
        }

        const addTag = (tag: Tags) => {
            const tagName = Tags[tag]; // Convert enum value to string name
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

            if(file == null) {
                logger.error(extension, "File is null");
                break;
            }

            if (file.filetype === ExtFileType.JS) {
                try {
                    const content = file.getContent();

                    // Check for webpack
                    if (
                        content.includes('__webpack_require__') ||
                        content.includes('webpackChunk') ||
                        /\(\d+,\s*function\s*\(\s*\w+,\s*\w+,\s*\w+\s*\)/.test(
                            content.substring(0, 10000)
                        )
                    ) {
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
