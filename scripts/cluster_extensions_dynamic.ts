#!/usr/bin/env ts-node

/**
 * Dynamic Extension API Clustering Script
 *
 * Features:
 * - NO HARDCODED API PATTERNS - discovers APIs dynamically from extensions
 * - Auto-determines optimal cluster count using silhouette analysis
 * - Groups APIs by domain (tabs, storage, runtime, etc.)
 * - Shows API usage statistics, not extension lists
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { find_extensions } from '../migrator/utils/find_extensions';
import { Extension } from '../migrator/types/extension';
import { Database, Collections } from '../migrator/features/database/db_manager';
import { LazyFile } from '../migrator/types/abstract_file';
import { kmeans } from 'ml-kmeans';
import chalk from 'chalk';

dotenv.config();

interface APIUsage {
    [api: string]: number;
}

interface ExtensionData {
    id: string;
    name: string;
    source: 'filesystem' | 'database' | 'output';
    manifestVersion: number;
    baseApiUsage: APIUsage; // e.g., chrome.tabs
    fullApiUsage: APIUsage; // e.g., chrome.tabs.query
    totalApiCalls: number;
}

interface ClusterResult {
    clusterId: number;
    clusterName: string;
    extensions: ExtensionData[];
    centroid: number[];
    commonAPIs: string[];
}

interface APIDomainStats {
    domain: string;
    apis: Array<{
        api: string;
        extensionCount: number;
        totalCalls: number;
        needsMigration: boolean;
    }>;
    totalExtensions: number;
    totalCalls: number;
    unmigrated: number;
}

interface MigrationInfo {
    mv2API: string;
    mv3API: string;
    status: 'deprecated' | 'limited' | 'removed';
    autoMigratable: boolean;
}

/**
 * Extract ALL Chrome API usage dynamically (no hardcoded patterns)
 */
function extractAllAPIUsage(extension: Extension): {
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
function buildVocabulary(allExtensions: ExtensionData[]): string[] {
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
function apiUsageToVector(apiUsage: APIUsage, vocabulary: string[]): number[] {
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
function normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map((val) => val / magnitude);
}

/**
 * Calculate silhouette score for clustering quality
 */
function calculateSilhouetteScore(vectors: number[][], clusters: number[]): number {
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

function euclideanDistance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += (a[i] - b[i]) ** 2;
    }
    return Math.sqrt(sum);
}

/**
 * Find optimal number of clusters using silhouette analysis
 */
function findOptimalClusters(
    extensions: ExtensionData[],
    vocabulary: string[],
    minClusters: number = 2,
    maxClusters: number = 10
): number {
    if (extensions.length < minClusters) {
        return Math.max(1, extensions.length);
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
function clusterExtensions(
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
 * Generate cluster name based on common APIs
 */
function generateClusterName(commonAPIs: string[], extensions: ExtensionData[]): string {
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
            priority: 10,
            qualifiers: [
                { apis: ['chrome.proxy'], suffix: ' with Proxy' },
                { apis: ['chrome.storage'], suffix: ' with Filtering Rules' },
            ],
        },
        {
            apis: ['chrome.debugger', 'chrome.devtools'],
            name: 'Developer & Debugging Tools',
            priority: 9,
        },
        {
            apis: ['chrome.downloads'],
            name: 'Download Management',
            priority: 8,
        },
        {
            apis: ['chrome.proxy'],
            name: 'Proxy & Network Control',
            priority: 8,
        },
        {
            apis: ['chrome.scripting', 'chrome.tabs.executeScript'],
            name: 'Content Script Injectors',
            priority: 7,
        },
        {
            apis: ['chrome.contextMenus'],
            name: 'Context Menu Extensions',
            priority: 7,
        },
        {
            apis: ['chrome.action', 'chrome.browserAction', 'chrome.pageAction'],
            name: 'Browser Toolbar Actions',
            priority: 6,
        },
        {
            apis: ['chrome.bookmarks', 'chrome.history'],
            name: 'Bookmarks & History',
            priority: 6,
        },
        {
            apis: ['chrome.tabs', 'chrome.windows'],
            name: 'Tab & Window Management',
            priority: 5,
        },
        {
            apis: ['chrome.storage'],
            name: 'Data Storage & Sync',
            priority: 4,
        },
        {
            apis: ['chrome.notifications', 'chrome.alarms'],
            name: 'Notifications & Timers',
            priority: 4,
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
const MV2_TO_MV3_MAP: { [key: string]: MigrationInfo } = {
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
    'chrome.webRequest': {
        mv2API: 'chrome.webRequest',
        mv3API: 'chrome.declarativeNetRequest',
        status: 'limited',
        autoMigratable: false,
    },
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
};

/**
 * Check if an API needs migration
 */
function needsMigration(api: string): boolean {
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
 * Group APIs by domain and calculate statistics
 */
function groupAPIsByDomain(allExtensions: ExtensionData[]): APIDomainStats[] {
    const domains = new Map<string, Map<string, { extensionCount: number; totalCalls: number }>>();

    // Collect all APIs and their usage
    for (const ext of allExtensions) {
        for (const [fullApi, count] of Object.entries(ext.fullApiUsage)) {
            if (count === 0) continue;

            // Extract domain (chrome.tabs from chrome.tabs.query)
            const parts = fullApi.split('.');
            if (parts.length < 2) continue;

            const domain = parts.slice(0, 2).join('.');

            if (!domains.has(domain)) {
                domains.set(domain, new Map());
            }

            const domainApis = domains.get(domain)!;
            if (!domainApis.has(fullApi)) {
                domainApis.set(fullApi, { extensionCount: 0, totalCalls: 0 });
            }

            const apiStats = domainApis.get(fullApi)!;
            apiStats.extensionCount++;
            apiStats.totalCalls += count;
        }
    }

    // Convert to array and sort
    const result: APIDomainStats[] = [];

    for (const [domain, apis] of domains.entries()) {
        let unmigratedCount = 0;

        const apiArray = Array.from(apis.entries()).map(([api, stats]) => {
            const requiresMigration = needsMigration(api);
            if (requiresMigration) {
                unmigratedCount++;
            }

            return {
                api,
                extensionCount: stats.extensionCount,
                totalCalls: stats.totalCalls,
                needsMigration: requiresMigration,
            };
        });

        apiArray.sort((a, b) => {
            // Sort unmigrated first, then by extension count
            if (a.needsMigration !== b.needsMigration) {
                return a.needsMigration ? -1 : 1;
            }
            return b.extensionCount - a.extensionCount;
        });

        const uniqueExtensions = new Set<string>();
        for (const ext of allExtensions) {
            if (ext.baseApiUsage[domain] && ext.baseApiUsage[domain] > 0) {
                uniqueExtensions.add(ext.id);
            }
        }

        const totalCalls = apiArray.reduce((sum, api) => sum + api.totalCalls, 0);

        result.push({
            domain,
            apis: apiArray,
            totalExtensions: uniqueExtensions.size,
            totalCalls,
            unmigrated: unmigratedCount,
        });
    }

    // Sort by unmigrated count first, then by total extensions
    result.sort((a, b) => {
        if (a.unmigrated !== b.unmigrated) {
            return b.unmigrated - a.unmigrated;
        }
        return b.totalExtensions - a.totalExtensions;
    });

    return result;
}

// ... (loading functions remain the same - filesystem, database, output)

async function loadExtensionsFromFilesystem(inputPath: string): Promise<ExtensionData[]> {
    console.log(chalk.blue(`Loading extensions from ${inputPath}...`));

    if (!fs.existsSync(inputPath)) {
        console.log(chalk.yellow(`Path does not exist: ${inputPath}`));
        return [];
    }

    const extensions = find_extensions(inputPath, false);
    const extensionData: ExtensionData[] = [];

    for (const ext of extensions) {
        const { baseApiUsage, fullApiUsage } = extractAllAPIUsage(ext);
        const totalApiCalls = Object.values(fullApiUsage).reduce((sum, count) => sum + count, 0);

        extensionData.push({
            id: ext.id,
            name: ext.name,
            source: 'filesystem',
            manifestVersion: ext.manifest?.manifest_version || 2,
            baseApiUsage,
            fullApiUsage,
            totalApiCalls,
        });

        ext.files.forEach((f) => f.close());
    }

    console.log(chalk.green(`✓ Loaded ${extensionData.length} extensions from filesystem`));
    return extensionData;
}

async function loadExtensionsFromDatabase(): Promise<ExtensionData[]> {
    console.log(chalk.blue('Loading extensions from database...'));

    try {
        const db = Database.shared;

        if (!db.database) {
            await db.init();
        }

        const collection = db.database!.collection(Collections.EXTENSIONS);
        const extensions = await collection.find({}).toArray();

        const extensionData: ExtensionData[] = [];

        for (const ext of extensions) {
            const extension: Extension = {
                id: ext.id,
                name: ext.name,
                manifest_v2_path: ext.manifest_v2_path,
                manifest: ext.manifest,
                files: [],
                tags: ext.tags,
            };

            if (ext.files && Array.isArray(ext.files)) {
                extension.files = ext.files.map((f: any) => {
                    const mockFile = Object.create(LazyFile.prototype);
                    mockFile.path = f.path;
                    mockFile.filetype = f.filetype;
                    mockFile.getContent = () => f.content || '';
                    mockFile.close = () => {};
                    return mockFile;
                });

                const { baseApiUsage, fullApiUsage } = extractAllAPIUsage(extension);
                const totalApiCalls = Object.values(fullApiUsage).reduce(
                    (sum, count) => sum + count,
                    0
                );

                extensionData.push({
                    id: extension.id,
                    name: extension.name,
                    source: 'database',
                    manifestVersion: extension.manifest?.manifest_version || 2,
                    baseApiUsage,
                    fullApiUsage,
                    totalApiCalls,
                });
            }
        }

        console.log(chalk.green(`✓ Loaded ${extensionData.length} extensions from database`));
        return extensionData;
    } catch (error) {
        console.log(chalk.yellow(`Could not load from database: ${error}`));
        return [];
    }
}

async function loadExtensionsFromOutput(outputPath: string): Promise<ExtensionData[]> {
    console.log(chalk.blue(`Loading migrated extensions from ${outputPath}...`));

    if (!fs.existsSync(outputPath)) {
        console.log(chalk.yellow(`Output path does not exist: ${outputPath}`));
        return [];
    }

    const extensions = find_extensions(outputPath, true);
    const extensionData: ExtensionData[] = [];

    for (const ext of extensions) {
        const { baseApiUsage, fullApiUsage } = extractAllAPIUsage(ext);
        const totalApiCalls = Object.values(fullApiUsage).reduce((sum, count) => sum + count, 0);

        extensionData.push({
            id: ext.id,
            name: ext.name,
            source: 'output',
            manifestVersion: ext.manifest?.manifest_version || 3,
            baseApiUsage,
            fullApiUsage,
            totalApiCalls,
        });

        ext.files.forEach((f) => f.close());
    }

    console.log(chalk.green(`✓ Loaded ${extensionData.length} extensions from output`));
    return extensionData;
}

// TODO: Add generateVisualization function here

async function main() {
    console.log(chalk.bold.cyan('\n🔬 Dynamic Extension API Clustering Tool\n'));

    const args = process.argv.slice(2);

    // Parse arguments
    let inputPath: string | null = null;
    let outputPath: string | null = null;
    let useDatabase = false;
    let numClusters: number | 'auto' = 'auto';
    let visualizationFile = './cluster_visualization.html';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--input' || args[i] === '-i') {
            inputPath = args[++i];
        } else if (args[i] === '--output' || args[i] === '-o') {
            outputPath = args[++i];
        } else if (args[i] === '--database' || args[i] === '-d') {
            useDatabase = true;
        } else if (args[i] === '--clusters' || args[i] === '-c') {
            const val = args[++i];
            numClusters = val === 'auto' ? 'auto' : parseInt(val);
        } else if (args[i] === '--viz' || args[i] === '-v') {
            visualizationFile = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: npm run cluster:dynamic [-- options]

Options:
  -i, --input <path>       Path to input extensions directory
  -o, --output <path>      Path to migrated extensions output directory
  -d, --database           Load extensions from MongoDB database
  -c, --clusters <num>     Number of clusters (default: auto)
  -v, --viz <file>         Output HTML file (default: ./cluster_visualization.html)
  -h, --help               Show this help message

Examples:
  npm run cluster:dynamic -- --input ./extensions --clusters auto
  npm run cluster:dynamic -- --input ./extensions --clusters 5
            `);
            process.exit(0);
        }
    }

    // Load extensions
    const allExtensions: ExtensionData[] = [];

    if (inputPath) {
        const fsExtensions = await loadExtensionsFromFilesystem(inputPath);
        allExtensions.push(...fsExtensions);
    }

    if (useDatabase) {
        const dbExtensions = await loadExtensionsFromDatabase();
        allExtensions.push(...dbExtensions);
    }

    if (outputPath) {
        const outputExtensions = await loadExtensionsFromOutput(outputPath);
        allExtensions.push(...outputExtensions);
    }

    if (allExtensions.length === 0) {
        console.log(chalk.red('\n❌ Error: No extensions loaded.\n'));
        process.exit(1);
    }

    // Build vocabulary
    const vocabulary = buildVocabulary(allExtensions);
    console.log(chalk.blue(`Found ${vocabulary.length} unique API domains`));

    // Determine cluster count
    let finalClusterCount: number;
    if (numClusters === 'auto') {
        finalClusterCount = findOptimalClusters(allExtensions, vocabulary);
    } else {
        finalClusterCount = Math.min(numClusters as number, Math.floor(allExtensions.length / 2));
    }

    // Perform clustering
    const clusters = clusterExtensions(allExtensions, finalClusterCount, vocabulary);

    // Group APIs by domain
    const apiDomains = groupAPIsByDomain(allExtensions);

    // Print summary
    console.log(chalk.bold.cyan('\n📊 Clustering Summary:\n'));
    clusters.forEach((cluster) => {
        console.log(chalk.bold(`${cluster.clusterName} (Cluster ${cluster.clusterId}):`));
        console.log(`  Extensions: ${cluster.extensions.length}`);
        console.log(`  Common APIs: ${cluster.commonAPIs.slice(0, 3).join(', ')}`);
        console.log('');
    });

    console.log(chalk.bold.cyan('\n📊 API Domain Usage:\n'));
    apiDomains.slice(0, 10).forEach((domain) => {
        const needsMigrationTag =
            domain.unmigrated > 0 ? chalk.red(` [${domain.unmigrated} APIs need migration]`) : '';
        console.log(chalk.bold(`${domain.domain}:`) + needsMigrationTag);
        console.log(`  Extensions: ${domain.totalExtensions}`);
        console.log(`  Total calls: ${domain.totalCalls}`);

        // Show top 5 APIs with migration status
        console.log(`  APIs:`);
        domain.apis.slice(0, 5).forEach((api) => {
            const migrationTag = api.needsMigration ? chalk.red(' ⚠️  MV2') : '';
            const shortName = api.api.replace(domain.domain + '.', '');
            console.log(
                chalk.gray(`    - ${shortName} (${api.extensionCount} ext)${migrationTag}`)
            );
        });
        console.log('');
    });

    // Show extensions that need migration
    const extensionsNeedingMigration = allExtensions.filter((ext) => {
        return Object.keys(ext.fullApiUsage).some((api) => needsMigration(api));
    });

    if (extensionsNeedingMigration.length > 0) {
        console.log(
            chalk.bold.red(
                `\n⚠️  ${extensionsNeedingMigration.length} extensions need MV2→MV3 migration:\n`
            )
        );
        extensionsNeedingMigration.slice(0, 10).forEach((ext) => {
            const deprecatedApis = Object.keys(ext.fullApiUsage).filter((api) =>
                needsMigration(api)
            );
            console.log(chalk.yellow(`  ${ext.name}:`));
            console.log(chalk.gray(`    Uses: ${deprecatedApis.slice(0, 3).join(', ')}`));
        });
        if (extensionsNeedingMigration.length > 10) {
            console.log(chalk.gray(`    ... and ${extensionsNeedingMigration.length - 10} more`));
        }
    } else {
        console.log(chalk.green('\n✓ All extensions use MV3-compatible APIs!'));
    }

    // TODO: Generate visualization
    console.log(chalk.yellow('\n⚠️  Visualization generation not yet implemented'));
    console.log(chalk.gray('(HTML generation code needs to be added)'));

    if (useDatabase) {
        await Database.shared.close();
    }
}

main().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});
