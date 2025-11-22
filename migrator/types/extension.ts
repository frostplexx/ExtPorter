import { LazyFile } from './abstract_file';

export interface Extension {
    id: string;
    name: string;
    version?: string;
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
        webRequest_to_dnr_migrations: number;
    };
    tags?: string[]; // Store tag names as enum string names (e.g., 'MANIFEST_MIGRATED') for readability in MongoDB
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
    cws_info?: {
        name?: string;
        description?: string;
        short_description?: string;
        images?: string[];
        rating?: number;
        rating_count?: number;
        user_count?: string;
        last_updated?: string;
        version?: string;
        size?: string;
        languages?: string[];
        developer?: string;
        developer_address?: string;
        developer_website?: string;
        privacy_policy?: string;
    };
}
