import { logger } from "../utils/logger";
import { LazyFile } from "./abstract_file";

export interface Extension {
    id: string,
    name: string,
    manifest_path: string,
    manifest: any,
    files: LazyFile[],
    isNewTabExtension?: boolean,
    mv3_extension_id?: string
}

export function closeExtensionFiles(extension: Extension): void {
    // Close all file descriptors for LazyFile objects
    extension.files.forEach(file => {
        try {
            file.close();
        } catch (error) {
            logger.warn(extension, `Error closing file ${file.path}:`, error);
        }
    });
}

export function isNewTabExtension(extension: Extension): boolean {
    const newtab = extension.manifest?.chrome_url_overrides?.newtab;
    return newtab != null && newtab !== '';
}
