/**
 * Chrome API patterns and categorization
 */

export const CHROME_API_CATEGORIES = {
    // Core APIs - Essential functionality
    core: ['chrome.runtime', 'chrome.storage', 'chrome.tabs', 'chrome.windows', 'chrome.extension'],

    // UI APIs - User interface elements
    ui: [
        'chrome.action',
        'chrome.browserAction',
        'chrome.pageAction',
        'chrome.contextMenus',
        'chrome.notifications',
        'chrome.omnibox',
        'chrome.sidePanel',
    ],

    // Content APIs - Page content and user data
    content: [
        'chrome.scripting',
        'chrome.contentSettings',
        'chrome.cookies',
        'chrome.downloads',
        'chrome.history',
        'chrome.bookmarks',
        'chrome.readingList',
    ],

    // Network APIs - Network and request handling
    network: [
        'chrome.webRequest',
        'chrome.webNavigation',
        'chrome.declarativeNetRequest',
        'chrome.proxy',
        'chrome.dns',
    ],

    // Security & Privacy APIs
    security: ['chrome.permissions', 'chrome.privacy', 'chrome.certificateProvider'],

    // System APIs - System integration
    system: [
        'chrome.alarms',
        'chrome.idle',
        'chrome.power',
        'chrome.system.cpu',
        'chrome.system.memory',
        'chrome.system.storage',
        'chrome.system.display',
    ],

    // Authentication & Identity
    auth: ['chrome.identity', 'chrome.webAuthenticationProxy'],

    // Advanced/Specialized APIs
    advanced: [
        'chrome.management',
        'chrome.sessions',
        'chrome.topSites',
        'chrome.webstore',
        'chrome.devtools',
        'chrome.debugger',
        'chrome.offscreen',
        'chrome.declarativeContent',
    ],

    // Communication APIs
    communication: [
        'chrome.runtime.sendMessage',
        'chrome.runtime.connect',
        'chrome.runtime.onMessage',
        'chrome.tabs.sendMessage',
    ],

    // Misc APIs
    misc: [
        'chrome.commands',
        'chrome.i18n',
        'chrome.tts',
        'chrome.ttsEngine',
        'chrome.fontSettings',
        'chrome.gcm',
        'chrome.instanceID',
    ],
} as const;

// Flatten all APIs into a single array
export const ALL_CHROME_APIS = Object.values(CHROME_API_CATEGORIES).flat();

// MV2-specific APIs that should be migrated
export const MV2_DEPRECATED_APIS = [
    'chrome.browserAction',
    'chrome.pageAction',
    'chrome.webRequest', // Partially deprecated (blocking)
    'chrome.tabs.executeScript',
    'chrome.tabs.insertCSS',
    'chrome.extension.getBackgroundPage',
] as const;

// MV3-only APIs
export const MV3_NEW_APIS = [
    'chrome.action',
    'chrome.declarativeNetRequest',
    'chrome.scripting',
    'chrome.offscreen',
    'chrome.sidePanel',
] as const;

// APIs that indicate complex functionality
export const COMPLEX_APIS = [
    'chrome.webRequest',
    'chrome.declarativeNetRequest',
    'chrome.debugger',
    'chrome.webAuthenticationProxy',
    'chrome.proxy',
    'chrome.certificateProvider',
] as const;

/**
 * Get the category of a Chrome API
 */
export function getApiCategory(api: string): keyof typeof CHROME_API_CATEGORIES | 'unknown' {
    for (const [category, apis] of Object.entries(CHROME_API_CATEGORIES)) {
        if (apis.some((categoryApi) => api.startsWith(categoryApi))) {
            return category as keyof typeof CHROME_API_CATEGORIES;
        }
    }
    return 'unknown';
}

/**
 * Check if an API is deprecated in MV3
 */
export function isDeprecatedInMV3(api: string): boolean {
    return MV2_DEPRECATED_APIS.some((deprecatedApi) => api.startsWith(deprecatedApi));
}

/**
 * Check if an API is new in MV3
 */
export function isNewInMV3(api: string): boolean {
    return MV3_NEW_APIS.some((newApi) => api.startsWith(newApi));
}

/**
 * Check if an API indicates complex functionality
 */
export function isComplexApi(api: string): boolean {
    return COMPLEX_APIS.some((complexApi) => api.startsWith(complexApi));
}

/**
 * Get migration suggestions for deprecated APIs
 */
export function getMigrationSuggestion(api: string): string | null {
    const suggestions: Record<string, string> = {
        'chrome.browserAction': 'chrome.action',
        'chrome.pageAction': 'chrome.action',
        'chrome.tabs.executeScript': 'chrome.scripting.executeScript',
        'chrome.tabs.insertCSS': 'chrome.scripting.insertCSS',
        'chrome.extension.getBackgroundPage': 'chrome.runtime.getBackgroundPage',
    };

    for (const [oldApi, newApi] of Object.entries(suggestions)) {
        if (api.startsWith(oldApi)) {
            return newApi;
        }
    }

    return null;
}
