import { logger } from '../utils/logger';
import { LazyFile } from './abstract_file';

export interface Extension {
    id: string;
    name: string;
    manifest_v2_path: string;
    manifest: any;
    files: LazyFile[];
    isNewTabExtension?: boolean;
    mv3_extension_id?: string;
    manifest_v3_path?: string;
    interestingness_score?: number;
    interestingness_breakdown?: {
        webRequest: number;
        html_lines: number;
        storage_local: number;
        background_page: number;
        content_scripts: number;
        dangerous_permissions: number;
        host_permissions: number;
        crypto_patterns: number;
        network_requests: number;
        extension_size: number;
        api_renames: number;
        manifest_changes: number;
        file_modifications: number;
    };
}

export function closeExtensionFiles(extension: Extension): void {
    // Close all file descriptors for LazyFile objects
    extension.files.forEach((file) => {
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
