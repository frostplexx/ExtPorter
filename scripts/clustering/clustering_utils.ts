/**
 * Shared clustering utilities
 */

import { Extension } from '../../migrator/types/extension';
import { APIUsage, ExtensionData, ClusterResult, MigrationInfo } from './types';
import { kmeans } from 'ml-kmeans';
import chalk from 'chalk';

/**
 * Extract ALL Chrome API usage dynamically (no hardcoded patterns)
 */
export function extractAllAPIUsage(extension: Extension): {
    baseApiUsage: APIUsage;
    fullApiUsage: APIUsage;
} {
    const baseApiUsage: APIUsage = {};
    const fullApiUsage: APIUsage = {};

    const bump = (map: APIUsage, key: string, inc = 1) => {
        map[key] = (map[key] || 0) + inc;
    };

    const espree = require('espree');

    for (const file of extension.files) {
        let content = '';
        try {
            content = file.getContent();
        } catch (e) {
            continue;
        }

        try {
            // AST-based extraction
            const ast = espree.parse(content, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                ecmaFeatures: { jsx: true },
                range: false,
                loc: false,
            });

            const stack: any[] = [ast];
            while (stack.length) {
                const node: any = stack.pop();
                if (!node || typeof node !== 'object') continue;

                for (const key of Object.keys(node)) {
                    const val: any = (node as any)[key];
                    if (val && typeof val === 'object') {
                        if (Array.isArray(val)) {
                            for (let i = val.length - 1; i >= 0; i--) stack.push(val[i]);
                        } else {
                            stack.push(val);
                        }
                    }
                }

                if (node.type === 'MemberExpression') {
                    const parts: string[] = [];
                    let cur: any = node;
                    let valid = true;
                    while (cur && cur.type === 'MemberExpression') {
                        const prop = cur.property;
                        const obj = cur.object;
                        if (cur.computed) {
                            valid = false;
                            break;
                        }
                        if (prop && prop.type === 'Identifier') {
                            parts.unshift(prop.name);
                        } else {
                            valid = false;
                            break;
                        }
                        cur = obj;
                    }
                    if (valid && cur && cur.type === 'Identifier' && cur.name === 'chrome') {
                        const full = 'chrome.' + parts.join('.');
                        bump(fullApiUsage, full);
                        const segs = full.split('.');
                        if (segs.length >= 2) {
                            const base = segs.slice(0, 2).join('.');
                            bump(baseApiUsage, base);
                        }
                    }
                }
            }
        } catch (_parseErr) {
            // Fallback: regex scan
            const matches = content.match(/chrome(?:\.[A-Za-z_$][\w$])+/g) || [];
            for (const m of matches) {
                bump(fullApiUsage, m);
                const segs = m.split('.');
                if (segs.length >= 2) {
                    const base = segs.slice(0, 2).join('.');
                    bump(baseApiUsage, base);
                }
            }
        }
    }

    return { baseApiUsage, fullApiUsage };
}

/**
 * Build vocabulary from all extensions
 */
export function buildVocabulary(allExtensions: ExtensionData[]): string[] {
    const set = new Set<string>();
    for (const ext of allExtensions) {
        for (const api of Object.keys(ext.baseApiUsage)) {
            set.add(api);
        }
    }
    return Array.from(set).sort();
}

/**
 * Convert API usage to feature vector
 */
export function apiUsageToVector(apiUsage: APIUsage, vocabulary: string[]): number[] {
    const vector: number[] = [];
    for (const api of vocabulary) {
        const count = apiUsage[api] || 0;
        vector.push(Math.log(count + 1));
    }
    return vector;
}

/**
 * Normalize vector
 */
export function normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map((val) => val / magnitude);
}

/**
 * Calculate Euclidean distance between two vectors
 */
export function euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
}

/**
 * Calculate silhouette score for clustering quality
 */
export function calculateSilhouetteScore(vectors: number[][], clusters: number[]): number {
    const n = vectors.length;
    if (n === 0) return 0;

    const k = Math.max(...clusters) + 1;
    const clusterGroups: number[][] = Array.from({ length: k }, () => []);

    clusters.forEach((c, i) => clusterGroups[c].push(i));

    let totalScore = 0;

    for (let i = 0; i < n; i++) {
        const myCluster = clusters[i];
        const myGroup = clusterGroups[myCluster];

        if (myGroup.length === 1) {
            // Silhouette is 0 for singleton clusters
            continue;
        }

        // Average distance to points in same cluster
        let a = 0;
        for (const j of myGroup) {
            if (i !== j) {
                a += euclideanDistance(vectors[i], vectors[j]);
            }
        }
        a /= myGroup.length - 1;

        // Minimum average distance to points in other clusters
        let b = Infinity;
        for (let c = 0; c < k; c++) {
            if (c === myCluster) continue;
            const otherGroup = clusterGroups[c];
            if (otherGroup.length === 0) continue;

            let avgDist = 0;
            for (const j of otherGroup) {
                avgDist += euclideanDistance(vectors[i], vectors[j]);
            }
            avgDist /= otherGroup.length;
            b = Math.min(b, avgDist);
        }

        if (b === Infinity) b = 0;

        const s = (b - a) / Math.max(a, b);
        totalScore += s;
    }

    return totalScore / n;
}

/**
 * Find optimal number of clusters using silhouette analysis
 */
export function findOptimalClusters(
    extensions: ExtensionData[],
    vocabulary: string[],
    minClusters: number = 2,
    maxClusters: number = 10
): number {
    if (extensions.length < minClusters) {
        return Math.max(1, extensions.length);
    }

    // For very large datasets (>1000), use heuristic instead of exhaustive search
    if (extensions.length > 1000) {
        console.log(chalk.blue('Large dataset detected, using heuristic for cluster count...'));
        // Rule of thumb: sqrt(n/2) clusters
        const heuristicK = Math.floor(Math.sqrt(extensions.length / 2));
        const clampedK = Math.max(minClusters, Math.min(maxClusters, heuristicK));
        console.log(
            chalk.green(
                `✓ Using ${clampedK} clusters (heuristic for ${extensions.length} extensions)`
            )
        );
        return clampedK;
    }

    const vectors = extensions.map((ext) => {
        const vector = apiUsageToVector(ext.baseApiUsage, vocabulary);
        return normalizeVector(vector);
    });

    const actualMax = Math.min(maxClusters, Math.floor(extensions.length / 2));

    let bestK = minClusters;
    let bestScore = -1;

    console.log(chalk.blue('Finding optimal cluster count...'));

    for (let k = minClusters; k <= actualMax; k++) {
        const result = kmeans(vectors, k, {
            initialization: 'kmeans++',
            maxIterations: 100,
        });

        const score = calculateSilhouetteScore(vectors, result.clusters);
        console.log(chalk.gray(`  k=${k}: silhouette=${score.toFixed(3)}`));

        if (score > bestScore) {
            bestScore = score;
            bestK = k;
        }
    }

    console.log(chalk.green(`✓ Optimal clusters: ${bestK} (silhouette=${bestScore.toFixed(3)})`));
    return bestK;
}

/**
 * Perform K-means clustering
 */
export function clusterExtensions(
    extensions: ExtensionData[],
    numClusters: number,
    vocabulary: string[]
): ClusterResult[] {
    console.log(
        chalk.blue(`Clustering ${extensions.length} extensions into ${numClusters} groups...`)
    );

    if (extensions.length === 0) {
        return [];
    }

    const vectors = extensions.map((ext) => {
        const vector = apiUsageToVector(ext.baseApiUsage, vocabulary);
        return normalizeVector(vector);
    });

    const result = kmeans(vectors, numClusters, {
        initialization: 'kmeans++',
        maxIterations: 100,
    });

    const clusters: Map<number, ExtensionData[]> = new Map();
    for (let i = 0; i < extensions.length; i++) {
        const clusterId = result.clusters[i];
        if (!clusters.has(clusterId)) {
            clusters.set(clusterId, []);
        }
        clusters.get(clusterId)!.push(extensions[i]);
    }

    const clusterResults: ClusterResult[] = [];
    for (const [clusterId, exts] of clusters.entries()) {
        const apiCounts: Map<string, number> = new Map();
        for (const ext of exts) {
            for (const api of vocabulary) {
                if ((ext.baseApiUsage[api] || 0) > 0) {
                    apiCounts.set(api, (apiCounts.get(api) || 0) + 1);
                }
            }
        }

        const threshold = exts.length * 0.5;
        const commonAPIs = Array.from(apiCounts.entries())
            .filter(([_, count]) => count >= threshold)
            .sort((a, b) => b[1] - a[1])
            .map(([api, _]) => api);

        const clusterName = generateClusterName(commonAPIs, exts);

        clusterResults.push({
            clusterId,
            clusterName,
            extensions: exts,
            centroid: result.centroids[clusterId],
            commonAPIs,
        });
    }

    console.log(chalk.green(`✓ Clustering complete`));
    return clusterResults;
}

/**
 * Generate cluster name based on common APIs with more granular categorization
 */
export function generateClusterName(commonAPIs: string[], _extensions: ExtensionData[]): string {
    if (commonAPIs.length === 0) {
        return 'General Extensions';
    }

    const categories: Array<{
        apis: string[];
        name: string;
        priority: number;
        qualifiers?: Array<{ apis: string[]; suffix: string }>;
    }> = [
        {
            apis: ['chrome.webRequest', 'chrome.declarativeNetRequest'],
            name: 'Network Request Interceptors',
            priority: 20,
            qualifiers: [
                { apis: ['chrome.proxy'], suffix: ' with Proxy Control' },
                { apis: ['chrome.storage'], suffix: ' with Filtering Rules' },
                { apis: ['chrome.webNavigation'], suffix: ' with Navigation Tracking' },
            ],
        },
        {
            apis: ['chrome.debugger'],
            name: 'Chrome Debugger Extensions',
            priority: 19,
        },
        {
            apis: ['chrome.devtools'],
            name: 'DevTools Panel Extensions',
            priority: 18,
        },
        {
            apis: ['chrome.downloads'],
            name: 'Download Managers',
            priority: 17,
            qualifiers: [{ apis: ['chrome.notifications'], suffix: ' with Notifications' }],
        },
        {
            apis: ['chrome.proxy'],
            name: 'Proxy Controllers',
            priority: 16,
        },
        {
            apis: ['chrome.scripting', 'chrome.tabs.executeScript'],
            name: 'Content Script Injectors',
            priority: 15,
            qualifiers: [{ apis: ['chrome.tabs'], suffix: ' with Tab Management' }],
        },
        {
            apis: ['chrome.contextMenus'],
            name: 'Context Menu Enhancers',
            priority: 14,
            qualifiers: [
                { apis: ['chrome.tabs'], suffix: ' with Tab Actions' },
                { apis: ['chrome.storage'], suffix: ' with Settings' },
            ],
        },
        {
            apis: ['chrome.action', 'chrome.browserAction'],
            name: 'Toolbar Button Extensions',
            priority: 13,
            qualifiers: [
                { apis: ['chrome.notifications'], suffix: ' with Notifications' },
                { apis: ['chrome.storage'], suffix: ' with Persistent State' },
            ],
        },
        {
            apis: ['chrome.pageAction'],
            name: 'Page-Specific Actions',
            priority: 12,
        },
        {
            apis: ['chrome.bookmarks'],
            name: 'Bookmark Managers',
            priority: 11,
            qualifiers: [{ apis: ['chrome.tabs'], suffix: ' with Tab Integration' }],
        },
        {
            apis: ['chrome.history'],
            name: 'History Analyzers',
            priority: 10,
        },
        {
            apis: ['chrome.tabs', 'chrome.windows'],
            name: 'Tab & Window Managers',
            priority: 9,
            qualifiers: [
                { apis: ['chrome.sessions'], suffix: ' with Session Restore' },
                { apis: ['chrome.storage'], suffix: ' with State Persistence' },
            ],
        },
        {
            apis: ['chrome.cookies'],
            name: 'Cookie Managers',
            priority: 8,
        },
        {
            apis: ['chrome.storage'],
            name: 'Data Storage Extensions',
            priority: 7,
            qualifiers: [{ apis: ['chrome.identity'], suffix: ' with Cloud Sync' }],
        },
        {
            apis: ['chrome.notifications'],
            name: 'Notification Systems',
            priority: 6,
            qualifiers: [{ apis: ['chrome.alarms'], suffix: ' with Scheduled Alerts' }],
        },
        {
            apis: ['chrome.alarms'],
            name: 'Background Task Schedulers',
            priority: 5,
        },
        {
            apis: ['chrome.identity'],
            name: 'Authentication & Identity',
            priority: 4,
        },
        {
            apis: ['chrome.runtime'],
            name: 'Core Runtime Extensions',
            priority: 3,
        },
        {
            apis: ['chrome.permissions'],
            name: 'Dynamic Permission Managers',
            priority: 2,
        },
    ];

    const matches = categories
        .map((category) => {
            const matchCount = category.apis.filter((api) => commonAPIs.includes(api)).length;
            return {
                category,
                matchCount,
                score: matchCount * category.priority,
            };
        })
        .filter((m) => m.matchCount > 0)
        .sort((a, b) => b.score - a.score);

    if (matches.length > 0) {
        let name = matches[0].category.name;

        if (matches[0].category.qualifiers) {
            for (const qualifier of matches[0].category.qualifiers) {
                if (qualifier.apis.some((api) => commonAPIs.includes(api))) {
                    name += qualifier.suffix;
                    break;
                }
            }
        }

        return name;
    }

    const topAPIs = commonAPIs.slice(0, 2).map((api) => {
        const shortName = api.replace('chrome.', '');
        return shortName
            .replace(/([A-Z])/g, ' $1')
            .trim()
            .split(' ')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');
    });

    return topAPIs.join(' + ') + ' Extensions';
}

/**
 * MV2 to MV3 API migration map
 */
export const MV2_TO_MV3_MAP: { [key: string]: MigrationInfo } = {
    // Action APIs (browserAction/pageAction → action)
    'chrome.browserAction': {
        mv2API: 'chrome.browserAction',
        mv3API: 'chrome.action',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.pageAction': {
        mv2API: 'chrome.pageAction',
        mv3API: 'chrome.action',
        status: 'deprecated',
        autoMigratable: true,
    },

    // Web Request API (blocking → declarativeNetRequest)
    'chrome.webRequest': {
        mv2API: 'chrome.webRequest',
        mv3API: 'chrome.declarativeNetRequest',
        status: 'limited',
        autoMigratable: false,
    },

    // Scripting APIs (tabs → scripting)
    'chrome.tabs.executeScript': {
        mv2API: 'chrome.tabs.executeScript',
        mv3API: 'chrome.scripting.executeScript',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.tabs.insertCSS': {
        mv2API: 'chrome.tabs.insertCSS',
        mv3API: 'chrome.scripting.insertCSS',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.tabs.removeCSS': {
        mv2API: 'chrome.tabs.removeCSS',
        mv3API: 'chrome.scripting.removeCSS',
        status: 'deprecated',
        autoMigratable: true,
    },

    // Extension API (moved to runtime)
    'chrome.extension': {
        mv2API: 'chrome.extension',
        mv3API: 'chrome.runtime',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.getBackgroundPage': {
        mv2API: 'chrome.extension.getBackgroundPage',
        mv3API: 'chrome.runtime.getBackgroundPage',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.getURL': {
        mv2API: 'chrome.extension.getURL',
        mv3API: 'chrome.runtime.getURL',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.sendMessage': {
        mv2API: 'chrome.extension.sendMessage',
        mv3API: 'chrome.runtime.sendMessage',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.onMessage': {
        mv2API: 'chrome.extension.onMessage',
        mv3API: 'chrome.runtime.onMessage',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.onConnect': {
        mv2API: 'chrome.extension.onConnect',
        mv3API: 'chrome.runtime.onConnect',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.connect': {
        mv2API: 'chrome.extension.connect',
        mv3API: 'chrome.runtime.connect',
        status: 'deprecated',
        autoMigratable: true,
    },
    'chrome.extension.getViews': {
        mv2API: 'chrome.extension.getViews',
        mv3API: 'chrome.runtime.getViews',
        status: 'deprecated',
        autoMigratable: true,
    },

    // App API (entirely removed)
    'chrome.app': {
        mv2API: 'chrome.app',
        mv3API: null,
        status: 'removed',
        autoMigratable: false,
    },

    // Permissions API (shape changed)
    'chrome.permissions': {
        mv2API: 'chrome.permissions',
        mv3API: 'chrome.permissions',
        status: 'changed',
        autoMigratable: false,
    },

    // Storage API (limits changed for sync)
    'chrome.storage': {
        mv2API: 'chrome.storage',
        mv3API: 'chrome.storage',
        status: 'changed',
        autoMigratable: false,
    },

    // Management API (some methods changed)
    'chrome.management': {
        mv2API: 'chrome.management',
        mv3API: 'chrome.management',
        status: 'changed',
        autoMigratable: false,
    },

    // Tabs API (some methods deprecated)
    'chrome.tabs': {
        mv2API: 'chrome.tabs',
        mv3API: 'chrome.tabs',
        status: 'changed',
        autoMigratable: false,
    },

    // Windows API (some changes)
    'chrome.windows': {
        mv2API: 'chrome.windows',
        mv3API: 'chrome.windows',
        status: 'changed',
        autoMigratable: false,
    },

    // Bookmarks API (some changes)
    'chrome.bookmarks': {
        mv2API: 'chrome.bookmarks',
        mv3API: 'chrome.bookmarks',
        status: 'changed',
        autoMigratable: false,
    },

    // History API (some changes)
    'chrome.history': {
        mv2API: 'chrome.history',
        mv3API: 'chrome.history',
        status: 'changed',
        autoMigratable: false,
    },

    // Downloads API (some changes)
    'chrome.downloads': {
        mv2API: 'chrome.downloads',
        mv3API: 'chrome.downloads',
        status: 'changed',
        autoMigratable: false,
    },

    // Context Menus API (some changes)
    'chrome.contextMenus': {
        mv2API: 'chrome.contextMenus',
        mv3API: 'chrome.contextMenus',
        status: 'changed',
        autoMigratable: false,
    },

    // Notifications API (some changes)
    'chrome.notifications': {
        mv2API: 'chrome.notifications',
        mv3API: 'chrome.notifications',
        status: 'changed',
        autoMigratable: false,
    },

    // Omnibox API (some changes)
    'chrome.omnibox': {
        mv2API: 'chrome.omnibox',
        mv3API: 'chrome.omnibox',
        status: 'changed',
        autoMigratable: false,
    },

    // Proxy API (deprecated)
    'chrome.proxy': {
        mv2API: 'chrome.proxy',
        mv3API: null,
        status: 'removed',
        autoMigratable: false,
    },
};

/**
 * Check if an API needs migration
 */
export function needsMigration(api: string): boolean {
    // Check if exact API match
    if (MV2_TO_MV3_MAP[api]) {
        return true;
    }

    // Check if API starts with deprecated domain
    for (const deprecatedApi of Object.keys(MV2_TO_MV3_MAP)) {
        if (api.startsWith(deprecatedApi + '.')) {
            return true;
        }
    }

    return false;
}

/**
 * Identify edge case / problematic APIs that may cause migration issues
 */
export function identifyEdgeCaseAPIs(extensions: any[]): Array<{
    api: string;
    reason: string;
    extensionCount: number;
    severity: 'high' | 'medium' | 'low';
}> {
    const apiUsageCount = new Map<string, number>();

    // Count API usage across extensions
    for (const ext of extensions) {
        for (const api of Object.keys(ext.fullApiUsage || {})) {
            if (ext.fullApiUsage[api] > 0) {
                apiUsageCount.set(api, (apiUsageCount.get(api) || 0) + 1);
            }
        }
    }

    const edgeCases: Array<{
        api: string;
        reason: string;
        extensionCount: number;
        severity: 'high' | 'medium' | 'low';
    }> = [];

    // High severity: Blocking webRequest (difficult migration)
    const blockingWebRequest = [
        'chrome.webRequest.onBeforeRequest',
        'chrome.webRequest.onBeforeSendHeaders',
        'chrome.webRequest.onHeadersReceived',
        'chrome.webRequest.onAuthRequired',
    ];
    for (const api of blockingWebRequest) {
        const count = apiUsageCount.get(api) || 0;
        if (count > 0) {
            edgeCases.push({
                api,
                reason: 'Blocking webRequest requires complex migration to declarativeNetRequest',
                extensionCount: count,
                severity: 'high',
            });
        }
    }

    // High severity: Background page dependencies
    const backgroundPageAPIs = ['chrome.extension.getBackgroundPage', 'chrome.extension.getViews'];
    for (const api of backgroundPageAPIs) {
        const count = apiUsageCount.get(api) || 0;
        if (count > 0) {
            edgeCases.push({
                api,
                reason: 'Persistent background page incompatible with service workers',
                extensionCount: count,
                severity: 'high',
            });
        }
    }

    // Medium severity: executeScript requires permission changes
    const executeScriptAPIs = ['chrome.tabs.executeScript', 'chrome.tabs.insertCSS'];
    for (const api of executeScriptAPIs) {
        const count = apiUsageCount.get(api) || 0;
        if (count > 0) {
            edgeCases.push({
                api,
                reason: 'Requires migration to chrome.scripting with host permissions',
                extensionCount: count,
                severity: 'medium',
            });
        }
    }

    // Medium severity: Browser/Page action consolidation
    const actionAPIs = ['chrome.browserAction', 'chrome.pageAction'];
    for (const api of actionAPIs) {
        const count = apiUsageCount.get(api) || 0;
        if (count > 0) {
            edgeCases.push({
                api,
                reason: 'Must migrate to chrome.action API',
                extensionCount: count,
                severity: 'medium',
            });
        }
    }

    // Low severity: Simple renames
    const simpleRenames = [
        'chrome.extension.getURL',
        'chrome.extension.sendMessage',
        'chrome.extension.connect',
    ];
    for (const api of simpleRenames) {
        const count = apiUsageCount.get(api) || 0;
        if (count > 0) {
            edgeCases.push({
                api,
                reason: 'Simple rename to chrome.runtime equivalent',
                extensionCount: count,
                severity: 'low',
            });
        }
    }

    // Sort by severity and extension count
    edgeCases.sort((a, b) => {
        const severityOrder = { high: 0, medium: 1, low: 2 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return b.extensionCount - a.extensionCount;
    });

    return edgeCases;
}
