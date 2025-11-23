import { Extension } from '../types/extension';
import { Tags } from '../types/tags';
import { logger } from './logger';

export const extensionUtils = {
    addTag: (extension: Extension, tag: Tags): Extension => {
        // Add tag to extension object
        if (!extension.tags) {
            extension.tags = [];
        }
        const new_tag = Tags[tag];
        if (!extension.tags.includes(new_tag)) {
            extension.tags.push(new_tag);
        }
        return extension;
    },

    closeExtensionFiles: (extension: Extension): void => {
        // Close all file descriptors for LazyFile objects
        extension.files.forEach((file) => {
            try {
                file.close();
            } catch (error) {
                logger.warn(extension, `Error closing file ${file.path}:`, error);
            }
        });
    },

    isNewTabExtension: (extension: Extension): boolean => {
        const newtab = extension.manifest?.chrome_url_overrides?.newtab;
        return newtab != null && newtab !== '';
    },
};
