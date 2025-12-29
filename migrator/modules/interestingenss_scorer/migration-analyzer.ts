import { Extension } from '../../types/extension';
import { ExtFileType } from '../../types/ext_file_types';
import { InterestingnessBreakdown } from './scoring-config';

/**
 * Analyzes migration-specific changes
 */
export function analyzeMigrationChanges(extension: Extension, scores: InterestingnessBreakdown): void {
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

        if (file == null) {
            console.error(extension, "File is null");
            break
        }

        if (file.filetype === ExtFileType.JS) {
            try {
                const content = file.getContent();
                // Look for common migration patterns that suggest file was modified
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
