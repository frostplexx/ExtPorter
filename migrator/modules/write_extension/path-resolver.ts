import * as path from 'path';
import { Extension } from '../../types/extension';
import { globals } from '../../index';

/**
 * Resolves the output path for an extension based on configuration
 * @param extension The extension to resolve the path for
 * @returns The resolved output path
 */
export function resolveOutputPath(extension: Extension): string {
    const useNewTabSubfolder = process.env.NEW_TAB_SUBFOLDER === 'true';
    const isNewTab = extension.isNewTabExtension || false;
    const extensionId = extension.mv3_extension_id || extension.id;

    if (useNewTabSubfolder && isNewTab) {
        return path.join(globals.outputDir, 'new_tab_extensions', extensionId);
    }

    return path.join(globals.outputDir, extensionId);
}
