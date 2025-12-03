/**
 * Configuration weights for interestingness scoring
 * Similar to extension_analyzer.py
 */
export const WEIGHTS = {
    webRequest: 5, // +25 per webRequest occurrence
    html_lines: 0.25, // +0.25 per line of HTML
    storage_local: 5, // +5 per storage.local occurrence
    background_page: 10, // +10 if has background page/service worker
    content_scripts: 4, // +4 if has content scripts
    dangerous_permissions: 3, // +8 per dangerous permission (tabs, cookies, history, etc.)
    host_permissions: 3, // +3 per external host permission
    crypto_patterns: 5, // +15 per crypto/obfuscation pattern (eval, Function, btoa, etc.)
    network_requests: 2, // +2 per network request pattern (fetch, XMLHttpRequest, etc.)
    extension_size: 1, // +1 per 100KB of extension size

    // Migration-specific weights
    api_renames: 10, // +10 per API rename detected
    manifest_changes: 5, // +5 per manifest field change
    file_modifications: 2, // +2 per modified file
    webRequest_to_dnr_migrations: 20, // +20 per webRequest to DNR migration
} as const;

/**
 * Dangerous permissions that increase interestingness score
 */
export const DANGEROUS_PERMISSIONS = new Set([
    'tabs',
    'activeTab',
    'cookies',
    'history',
    'bookmarks',
    'management',
    'privacy',
    'proxy',
    'downloads',
    'nativeMessaging',
    'webRequest',
    'webRequestBlocking',
    'declarativeNetRequest',
]);

/**
 * Interface for interestingness score breakdown
 */
export interface InterestingnessBreakdown {
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
}
