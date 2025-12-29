import { CWSData } from '../utils/cws_parser';
import { LazyFile } from './abstract_file';

export interface EventListener {
    api: string; // e.g., "chrome.runtime.onMessage"
    file: string; // File path where listener was found
    line?: number; // Line number (if available)
    code_snippet?: string; // Short snippet of the listener code
}

export interface Extension {
    id: string;
    name: string;
    version?: string;
    manifest_v2_path: string;
    manifest: any;
    // Files may be set to null to allow releasing large in-memory objects to the GC.
    // Consumers MUST handle null entries (filter or guard before accessing).
    files: (LazyFile | null)[];
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
        webRequest_to_dnr_migrations: number;
    };
    tags?: string[]; // Store tag names as enum string names (e.g., 'MANIFEST_MIGRATED') for readability in MongoDB
    event_listeners?: EventListener[]; // Extracted event listeners from static analysis
    fakeium_validation?: {
        enabled: boolean;
        is_equivalent: boolean;
        similarity_score: number;
        mv2_api_calls: number;
        mv3_api_calls: number;
        matched_calls: number;
        mv2_only_calls: number;
        mv3_only_calls: number;
        differences: string[];
        validation_errors: string[];
        duration_ms: number;
    };
    cws_info?: CWSData
}
