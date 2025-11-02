#!/usr/bin/env ts-node

/**
 * Extension API Clustering Script
 *
 * This script analyzes Chrome extensions by their API usage and clusters them
 * into groups. It can compare extensions from:
 * - Local filesystem (input directory)
 * - MongoDB database (original MV2 extensions)
 * - Output directory (migrated MV3 extensions)
 *
 * Features:
 * - Extracts Chrome API usage from JavaScript files
 * - Performs K-means clustering based on API similarity
 * - Generates interactive web visualization
 * - Compares MV2 vs MV3 API changes
 * - Auto-detects paths from .env file
 */

import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { find_extensions } from '../migrator/utils/find_extensions';
import { Extension } from '../migrator/types/extension';
import { Database, Collections } from '../migrator/features/database/db_manager';
import { LazyFile } from '../migrator/types/abstract_file';
import { kmeans } from 'ml-kmeans';
import chalk from 'chalk';

// Load environment variables
dotenv.config();

// API patterns to extract
const CHROME_API_PATTERNS = [
    // Core APIs
    'chrome.runtime',
    'chrome.storage',
    'chrome.tabs',
    'chrome.windows',
    'chrome.extension',

    // UI APIs
    'chrome.action',
    'chrome.browserAction',
    'chrome.pageAction',
    'chrome.contextMenus',
    'chrome.notifications',
    'chrome.omnibox',

    // Content APIs
    'chrome.scripting',
    'chrome.contentSettings',
    'chrome.cookies',
    'chrome.downloads',
    'chrome.history',
    'chrome.bookmarks',

    // Network APIs
    'chrome.webRequest',
    'chrome.webNavigation',
    'chrome.declarativeNetRequest',
    'chrome.proxy',

    // Advanced APIs
    'chrome.alarms',
    'chrome.identity',
    'chrome.management',
    'chrome.permissions',
    'chrome.privacy',
    'chrome.sessions',
    'chrome.topSites',
    'chrome.webstore',

    // Other
    'chrome.commands',
    'chrome.i18n',
    'chrome.idle',
    'chrome.system',
    'chrome.tts',
    'chrome.offscreen',
];

interface APIUsage {
    [api: string]: number;
}

interface ExtensionData {
    id: string;
    name: string;
    source: 'filesystem' | 'database' | 'output';
    manifestVersion: number;
    apiUsage: APIUsage;
    totalApiCalls: number;
}

interface ClusterResult {
    clusterId: number;
    clusterName: string;
    extensions: ExtensionData[];
    centroid: number[];
    commonAPIs: string[];
}

/**
 * Extract Chrome API usage from an extension
 */
function extractAPIUsage(extension: Extension): APIUsage {
    const apiUsage: APIUsage = {};

    // Initialize all APIs to 0
    CHROME_API_PATTERNS.forEach((api) => {
        apiUsage[api] = 0;
    });

    // Count API occurrences in all JavaScript files
    for (const file of extension.files) {
        try {
            const content = file.getContent();

            // Count each API pattern
            for (const api of CHROME_API_PATTERNS) {
                // Escape dots for regex
                const pattern = api.replace(/\./g, '\\.');
                const regex = new RegExp(pattern, 'g');
                const matches = content.match(regex);
                if (matches) {
                    apiUsage[api] += matches.length;
                }
            }
        } catch (error) {
            // Skip files that can't be read
            continue;
        }
    }

    return apiUsage;
}

/**
 * Convert API usage to feature vector for clustering
 */
function apiUsageToVector(apiUsage: APIUsage): number[] {
    const vector: number[] = [];

    // Use log scale to reduce impact of high-frequency APIs
    for (const api of CHROME_API_PATTERNS) {
        const count = apiUsage[api] || 0;
        // Log scale: log(count + 1) to handle 0 values
        vector.push(Math.log(count + 1));
    }

    return vector;
}

/**
 * Normalize a vector (L2 normalization)
 */
function normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (magnitude === 0) return vector;
    return vector.map((val) => val / magnitude);
}

/**
 * Load extensions from filesystem
 */
async function loadExtensionsFromFilesystem(inputPath: string): Promise<ExtensionData[]> {
    console.log(chalk.blue(`Loading extensions from ${inputPath}...`));

    if (!fs.existsSync(inputPath)) {
        console.log(chalk.yellow(`Path does not exist: ${inputPath}`));
        return [];
    }

    const extensions = find_extensions(inputPath, false);
    const extensionData: ExtensionData[] = [];

    for (const ext of extensions) {
        const apiUsage = extractAPIUsage(ext);
        const totalApiCalls = Object.values(apiUsage).reduce((sum, count) => sum + count, 0);

        extensionData.push({
            id: ext.id,
            name: ext.name,
            source: 'filesystem',
            manifestVersion: ext.manifest?.manifest_version || 2,
            apiUsage,
            totalApiCalls,
        });

        // Close file descriptors
        ext.files.forEach((f) => f.close());
    }

    console.log(chalk.green(`✓ Loaded ${extensionData.length} extensions from filesystem`));
    return extensionData;
}

/**
 * Load extensions from MongoDB
 */
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
            // Reconstruct Extension object
            const extension: Extension = {
                id: ext.id,
                name: ext.name,
                manifest_v2_path: ext.manifest_v2_path,
                manifest: ext.manifest,
                files: [], // Files not stored in DB with full content
                tags: ext.tags,
            };

            // If files are stored, use them
            if (ext.files && Array.isArray(ext.files)) {
                // Create temporary LazyFile objects from stored content
                extension.files = ext.files.map((f: any) => {
                    const mockFile = Object.create(LazyFile.prototype);
                    mockFile.path = f.path;
                    mockFile.filetype = f.filetype;
                    mockFile.getContent = () => f.content || '';
                    mockFile.close = () => {};
                    return mockFile;
                });

                const apiUsage = extractAPIUsage(extension);
                const totalApiCalls = Object.values(apiUsage).reduce(
                    (sum, count) => sum + count,
                    0
                );

                extensionData.push({
                    id: extension.id,
                    name: extension.name,
                    source: 'database',
                    manifestVersion: extension.manifest?.manifest_version || 2,
                    apiUsage,
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

/**
 * Load migrated extensions from output directory
 */
async function loadExtensionsFromOutput(outputPath: string): Promise<ExtensionData[]> {
    console.log(chalk.blue(`Loading migrated extensions from ${outputPath}...`));

    if (!fs.existsSync(outputPath)) {
        console.log(chalk.yellow(`Output path does not exist: ${outputPath}`));
        return [];
    }

    const extensions = find_extensions(outputPath, true);
    const extensionData: ExtensionData[] = [];

    for (const ext of extensions) {
        const apiUsage = extractAPIUsage(ext);
        const totalApiCalls = Object.values(apiUsage).reduce((sum, count) => sum + count, 0);

        extensionData.push({
            id: ext.id,
            name: ext.name,
            source: 'output',
            manifestVersion: ext.manifest?.manifest_version || 3,
            apiUsage,
            totalApiCalls,
        });

        // Close file descriptors
        ext.files.forEach((f) => f.close());
    }

    console.log(chalk.green(`✓ Loaded ${extensionData.length} extensions from output`));
    return extensionData;
}

/**
 * Generate a meaningful name for a cluster based on its common APIs (rule-based)
 */
function generateClusterNameRuleBased(commonAPIs: string[], _extensions: ExtensionData[]): string {
    if (commonAPIs.length === 0) {
        return 'General Extensions';
    }

    // Define API category patterns with priorities
    const categories: Array<{ apis: string[]; name: string; priority: number }> = [
        {
            apis: ['chrome.webRequest', 'chrome.declarativeNetRequest'],
            name: 'Ad Blockers & Privacy',
            priority: 10,
        },
        {
            apis: ['chrome.debugger', 'chrome.devtools'],
            name: 'Developer Tools',
            priority: 9,
        },
        {
            apis: ['chrome.downloads'],
            name: 'Download Managers',
            priority: 8,
        },
        {
            apis: ['chrome.proxy'],
            name: 'Proxy & VPN',
            priority: 8,
        },
        {
            apis: ['chrome.scripting', 'chrome.tabs.executeScript'],
            name: 'Content Modifiers',
            priority: 7,
        },
        {
            apis: ['chrome.contextMenus'],
            name: 'Context Menu Enhancers',
            priority: 7,
        },
        {
            apis: ['chrome.action', 'chrome.browserAction', 'chrome.pageAction'],
            name: 'Toolbar Extensions',
            priority: 6,
        },
        {
            apis: ['chrome.bookmarks', 'chrome.history'],
            name: 'Bookmark & History Tools',
            priority: 6,
        },
        {
            apis: ['chrome.tabs', 'chrome.windows'],
            name: 'Tab Managers',
            priority: 5,
        },
        {
            apis: ['chrome.storage', 'chrome.cookies'],
            name: 'Data Storage Extensions',
            priority: 4,
        },
        {
            apis: ['chrome.notifications', 'chrome.alarms'],
            name: 'Notification Tools',
            priority: 4,
        },
    ];

    // Find best matching category
    let bestCategory = '';
    let bestScore = 0;
    let bestPriority = 0;

    for (const category of categories) {
        const matchCount = category.apis.filter((api) => commonAPIs.includes(api)).length;
        const score = matchCount * category.priority;

        if (score > bestScore || (score === bestScore && category.priority > bestPriority)) {
            bestScore = score;
            bestPriority = category.priority;
            bestCategory = category.name;
        }
    }

    if (bestCategory) {
        return bestCategory;
    }

    // Fallback: Generate name from top APIs
    const topAPIs = commonAPIs.slice(0, 2).map((api) => {
        const shortName = api.replace('chrome.', '');
        return shortName.charAt(0).toUpperCase() + shortName.slice(1);
    });

    if (topAPIs.length === 1) {
        return `${topAPIs[0]} Extensions`;
    } else if (topAPIs.length === 2) {
        return `${topAPIs[0]} + ${topAPIs[1]}`;
    }

    return 'Mixed Extensions';
}

/**
 * Perform K-means clustering on extensions
 */
function clusterExtensions(extensions: ExtensionData[], numClusters: number): ClusterResult[] {
    console.log(
        chalk.blue(`Clustering ${extensions.length} extensions into ${numClusters} groups...`)
    );

    if (extensions.length === 0) {
        return [];
    }

    // Convert to feature vectors
    const vectors = extensions.map((ext) => {
        const vector = apiUsageToVector(ext.apiUsage);
        return normalizeVector(vector);
    });

    // Perform K-means clustering
    const result = kmeans(vectors, numClusters, {
        initialization: 'kmeans++',
        maxIterations: 100,
    });

    // Group extensions by cluster
    const clusters: Map<number, ExtensionData[]> = new Map();
    for (let i = 0; i < extensions.length; i++) {
        const clusterId = result.clusters[i];
        if (!clusters.has(clusterId)) {
            clusters.set(clusterId, []);
        }
        clusters.get(clusterId)!.push(extensions[i]);
    }

    // Create cluster results with metadata
    const clusterResults: ClusterResult[] = [];
    for (const [clusterId, exts] of clusters.entries()) {
        // Find common APIs (APIs used by most extensions in cluster)
        const apiCounts: Map<string, number> = new Map();
        for (const ext of exts) {
            for (const api of CHROME_API_PATTERNS) {
                if (ext.apiUsage[api] > 0) {
                    apiCounts.set(api, (apiCounts.get(api) || 0) + 1);
                }
            }
        }

        // Get APIs used by at least 50% of extensions in cluster
        const threshold = exts.length * 0.5;
        const commonAPIs = Array.from(apiCounts.entries())
            .filter(([_, count]) => count >= threshold)
            .sort((a, b) => b[1] - a[1])
            .map(([api, _]) => api);

        // Generate cluster name
        const clusterName = generateClusterNameRuleBased(commonAPIs, exts);

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
 * Generate HTML visualization
 */
function generateVisualization(
    clusters: ClusterResult[],
    allExtensions: ExtensionData[],
    outputFile: string
): void {
    console.log(chalk.blue('Generating visualization...'));

    // Prepare data for visualization
    const clusterData = clusters.map((cluster) => ({
        id: cluster.clusterId,
        name: cluster.clusterName,
        extensions: cluster.extensions.map((ext) => ({
            id: ext.id,
            name: ext.name,
            source: ext.source,
            manifestVersion: ext.manifestVersion,
            totalApiCalls: ext.totalApiCalls,
            topAPIs: Object.entries(ext.apiUsage)
                .filter(([_, count]) => count > 0)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([api, count]) => ({ api, count })),
        })),
        commonAPIs: cluster.commonAPIs,
        size: cluster.extensions.length,
    }));

    // Create statistics
    const stats = {
        totalExtensions: allExtensions.length,
        bySource: {
            filesystem: allExtensions.filter((e) => e.source === 'filesystem').length,
            database: allExtensions.filter((e) => e.source === 'database').length,
            output: allExtensions.filter((e) => e.source === 'output').length,
        },
        byManifestVersion: {
            v2: allExtensions.filter((e) => e.manifestVersion === 2).length,
            v3: allExtensions.filter((e) => e.manifestVersion === 3).length,
        },
        numClusters: clusters.length,
    };

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Extension API Clustering</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f0f0f;
            color: #e0e0e0;
            padding: 20px;
        }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .subtitle {
            color: #888;
            margin-bottom: 30px;
            font-size: 1.1rem;
        }
        .stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: #1a1a1a;
            padding: 20px;
            border-radius: 12px;
            border: 1px solid #333;
        }
        .stat-card h3 {
            font-size: 0.9rem;
            color: #888;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .stat-card .value {
            font-size: 2rem;
            font-weight: bold;
            color: #667eea;
        }
        .stat-card .subvalue {
            font-size: 0.9rem;
            color: #888;
            margin-top: 5px;
        }
        .section {
            background: #1a1a1a;
            padding: 30px;
            border-radius: 12px;
            margin-bottom: 30px;
            border: 1px solid #333;
        }
        .section h2 {
            font-size: 1.5rem;
            margin-bottom: 20px;
            color: #fff;
        }
        .cluster-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 20px;
            margin-top: 20px;
        }
        .cluster-card {
            background: #0f0f0f;
            padding: 20px;
            border-radius: 8px;
            border: 2px solid;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .cluster-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        .cluster-card h3 {
            font-size: 1.2rem;
            margin-bottom: 10px;
        }
        .cluster-card .cluster-size {
            color: #888;
            font-size: 0.9rem;
            margin-bottom: 15px;
        }
        .api-list {
            list-style: none;
            font-size: 0.85rem;
        }
        .api-list li {
            padding: 4px 0;
            color: #aaa;
            border-bottom: 1px solid #222;
        }
        .api-list li:last-child { border-bottom: none; }
        .extensions-list {
            margin-top: 15px;
            max-height: 200px;
            overflow-y: auto;
        }
        .extension-item {
            padding: 8px;
            margin: 4px 0;
            background: #1a1a1a;
            border-radius: 4px;
            font-size: 0.85rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .badge {
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-weight: bold;
        }
        .badge-filesystem { background: #667eea; color: white; }
        .badge-database { background: #f093fb; color: white; }
        .badge-output { background: #4facfe; color: white; }
        .badge-mv2 { background: #fa709a; color: white; margin-left: 4px; }
        .badge-mv3 { background: #30cfd0; color: white; margin-left: 4px; }
        #visualization, #migration-chart, #complexity-chart {
            width: 100%;
            height: 500px;
            border-radius: 8px;
            background: #0f0f0f;
        }
        #edge-cases {
            max-height: 600px;
            overflow-y: auto;
        }
        code {
            font-family: 'Monaco', 'Menlo', 'Courier New', monospace;
            font-size: 0.9em;
        }
        .modal {
            display: none;
            position: fixed;
            z-index: 1000;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            overflow: auto;
        }
        .modal-content {
            background: #1a1a1a;
            margin: 5% auto;
            padding: 30px;
            border: 1px solid #333;
            border-radius: 12px;
            width: 80%;
            max-width: 800px;
            max-height: 80vh;
            overflow-y: auto;
        }
        .close {
            color: #aaa;
            float: right;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
        }
        .close:hover { color: #fff; }
        
        /* Scrollbar styling */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }
        ::-webkit-scrollbar-track {
            background: #1a1a1a;
        }
        ::-webkit-scrollbar-thumb {
            background: #333;
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: #444;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 Extension API Clustering Analysis</h1>
        <p class="subtitle">Extensions grouped by Chrome API usage patterns</p>
        
        <div class="stats">
            <div class="stat-card">
                <h3>Total Extensions</h3>
                <div class="value">${stats.totalExtensions}</div>
            </div>
            <div class="stat-card">
                <h3>Clusters</h3>
                <div class="value">${stats.numClusters}</div>
            </div>
            <div class="stat-card">
                <h3>From Filesystem</h3>
                <div class="value">${stats.bySource.filesystem}</div>
            </div>
            <div class="stat-card">
                <h3>From Database</h3>
                <div class="value">${stats.bySource.database}</div>
            </div>
            <div class="stat-card">
                <h3>From Output</h3>
                <div class="value">${stats.bySource.output}</div>
            </div>
            <div class="stat-card">
                <h3>Manifest Versions</h3>
                <div class="value">${stats.byManifestVersion.v2 + stats.byManifestVersion.v3}</div>
                <div class="subvalue">MV2: ${stats.byManifestVersion.v2} | MV3: ${stats.byManifestVersion.v3}</div>
            </div>
        </div>
        
        <div class="section">
            <h2>🔍 Migration Status Analysis</h2>
            <p style="color: #888; margin-bottom: 20px;">
                Identify which clusters still use deprecated MV2 APIs vs MV3 APIs
            </p>
            <div id="migration-chart"></div>
        </div>
        
        <div class="section">
            <h2>📊 API Complexity by Cluster</h2>
            <p style="color: #888; margin-bottom: 20px;">
                Bubble size = total API calls. Find outliers and edge cases easily.
            </p>
            <div id="complexity-chart"></div>
        </div>
        
        <div class="section">
            <h2>⚠️ Potential Edge Cases</h2>
            <div id="edge-cases"></div>
        </div>
        
        <div class="section">
            <h2>🔧 API Migration Coverage</h2>
            <p style="color: #888; margin-bottom: 20px;">
                Track which deprecated MV2 APIs are still in use and need migration
            </p>
            <div id="api-coverage"></div>
        </div>
        
        <div class="section">
            <h2>📦 Cluster Details</h2>
            <div class="cluster-grid" id="clusters"></div>
        </div>
    </div>
    
    <div id="extensionModal" class="modal">
        <div class="modal-content">
            <span class="close">&times;</span>
            <div id="modalContent"></div>
        </div>
    </div>
    
    <script>
        const clusterData = ${JSON.stringify(clusterData)};
        const colors = ['#667eea', '#f093fb', '#4facfe', '#fa709a', '#30cfd0', '#a8edea', '#fed6e3', '#c471f5', '#12c2e9', '#f857a6'];
        
        // Prepare API migration analysis
        const mv2APIs = ['chrome.browserAction', 'chrome.pageAction', 'chrome.webRequest', 'chrome.tabs.executeScript', 'chrome.tabs.insertCSS'];
        const mv3APIs = ['chrome.action', 'chrome.declarativeNetRequest', 'chrome.scripting'];
        
        // Find API usage across all extensions
        const allAPIs = new Set();
        clusterData.forEach(cluster => {
            cluster.commonAPIs.forEach(api => allAPIs.add(api));
        });
        
        // Count MV2 vs MV3 API usage per cluster
        const clusterMigrationData = clusterData.map(cluster => {
            const mv2Count = cluster.extensions.filter(e => {
                return mv2APIs.some(api => e.topAPIs.some(a => a.api === api));
            }).length;
            const mv3Count = cluster.extensions.filter(e => {
                return mv3APIs.some(api => e.topAPIs.some(a => a.api === api));
            }).length;
            const bothCount = cluster.extensions.filter(e => {
                const hasMV2 = mv2APIs.some(api => e.topAPIs.some(a => a.api === api));
                const hasMV3 = mv3APIs.some(api => e.topAPIs.some(a => a.api === api));
                return hasMV2 && hasMV3;
            }).length;
            
            return {
                name: cluster.name || \`Cluster \${cluster.id}\`,
                mv2Only: mv2Count - bothCount,
                mv3Only: mv3Count - bothCount,
                both: bothCount,
                total: cluster.size
            };
        });
        
        // Create stacked bar chart for migration status
        const migrationTrace1 = {
            x: clusterMigrationData.map(d => d.name),
            y: clusterMigrationData.map(d => d.mv2Only),
            name: 'MV2 APIs Only',
            type: 'bar',
            marker: { color: '#fa709a' }
        };
        
        const migrationTrace2 = {
            x: clusterMigrationData.map(d => d.name),
            y: clusterMigrationData.map(d => d.both),
            name: 'Mixed MV2+MV3',
            type: 'bar',
            marker: { color: '#f093fb' }
        };
        
        const migrationTrace3 = {
            x: clusterMigrationData.map(d => d.name),
            y: clusterMigrationData.map(d => d.mv3Only),
            name: 'MV3 APIs Only',
            type: 'bar',
            marker: { color: '#30cfd0' }
        };
        
        const migrationLayout = {
            paper_bgcolor: '#0f0f0f',
            plot_bgcolor: '#0f0f0f',
            font: { color: '#e0e0e0' },
            barmode: 'stack',
            title: {
                text: 'Migration Status by Cluster',
                font: { color: '#e0e0e0', size: 18 }
            },
            xaxis: {
                title: 'Cluster',
                gridcolor: '#333',
                color: '#888'
            },
            yaxis: {
                title: 'Number of Extensions',
                gridcolor: '#333',
                color: '#888'
            },
            legend: {
                bgcolor: '#1a1a1a',
                bordercolor: '#333',
                borderwidth: 1
            }
        };
        
        Plotly.newPlot('migration-chart', [migrationTrace1, migrationTrace2, migrationTrace3], migrationLayout, {responsive: true});
        
        // Create 2D scatter plot showing API complexity vs cluster
        const complexityTraces = clusterData.map((cluster, idx) => ({
            x: cluster.extensions.map(() => idx),
            y: cluster.extensions.map(e => e.topAPIs.length),
            mode: 'markers',
            type: 'scatter',
            name: cluster.name || \`Cluster \${cluster.id}\`,
            marker: {
                size: cluster.extensions.map(e => Math.min(e.totalApiCalls / 2, 30)),
                color: colors[idx % colors.length],
                line: { color: '#fff', width: 1 },
                opacity: 0.7
            },
            text: cluster.extensions.map(e => \`\${e.name}<br>Unique APIs: \${e.topAPIs.length}<br>Total calls: \${e.totalApiCalls}<br>Source: \${e.source}\`),
            hoverinfo: 'text'
        }));
        
        const complexityLayout = {
            paper_bgcolor: '#0f0f0f',
            plot_bgcolor: '#0f0f0f',
            font: { color: '#e0e0e0' },
            title: {
                text: 'API Complexity Distribution',
                font: { color: '#e0e0e0', size: 18 }
            },
            xaxis: {
                title: 'Cluster',
                ticktext: clusterData.map(c => c.name || \`Cluster \${c.id}\`),
                tickvals: clusterData.map((_, idx) => idx),
                gridcolor: '#333',
                color: '#888'
            },
            yaxis: {
                title: 'Unique APIs Used',
                gridcolor: '#333',
                color: '#888'
            },
            showlegend: false,
            hovermode: 'closest'
        };
        
        Plotly.newPlot('complexity-chart', complexityTraces, complexityLayout, {responsive: true});
        
        // Detect edge cases
        const edgeCases = [];
        
        // Find extensions with unusual API combinations
        clusterData.forEach(cluster => {
            cluster.extensions.forEach(ext => {
                const hasMV2API = ext.topAPIs.some(a => mv2APIs.includes(a.api));
                const hasMV3API = ext.topAPIs.some(a => mv3APIs.includes(a.api));
                const unusualAPIs = ext.topAPIs.filter(a => 
                    !cluster.commonAPIs.includes(a.api)
                );
                
                if (hasMV2API && !hasMV3API) {
                    edgeCases.push({
                        extension: ext,
                        cluster: cluster.name || \`Cluster \${cluster.id}\`,
                        reason: 'Uses deprecated MV2 APIs',
                        severity: 'high',
                        apis: ext.topAPIs.filter(a => mv2APIs.includes(a.api)).map(a => a.api)
                    });
                }
                
                if (unusualAPIs.length >= 3) {
                    edgeCases.push({
                        extension: ext,
                        cluster: cluster.name || \`Cluster \${cluster.id}\`,
                        reason: \`Uses \${unusualAPIs.length} APIs not common in cluster\`,
                        severity: 'medium',
                        apis: unusualAPIs.slice(0, 3).map(a => a.api)
                    });
                }
                
                if (ext.topAPIs.length >= 15) {
                    edgeCases.push({
                        extension: ext,
                        cluster: cluster.name || \`Cluster \${cluster.id}\`,
                        reason: 'Very high API complexity (15+ unique APIs)',
                        severity: 'medium',
                        apis: [\`Uses \${ext.topAPIs.length} unique APIs\`]
                    });
                }
            });
        });
        
        // Create API coverage table
        const apiMigrationMap = {
            'chrome.browserAction': { mv3: 'chrome.action', status: 'deprecated' },
            'chrome.pageAction': { mv3: 'chrome.action', status: 'deprecated' },
            'chrome.webRequest': { mv3: 'chrome.declarativeNetRequest', status: 'limited' },
            'chrome.tabs.executeScript': { mv3: 'chrome.scripting.executeScript', status: 'deprecated' },
            'chrome.tabs.insertCSS': { mv3: 'chrome.scripting.insertCSS', status: 'deprecated' },
        };
        
        const apiCoverage = Object.entries(apiMigrationMap).map(([mv2API, info]) => {
            const extensionsUsing = [];
            clusterData.forEach(cluster => {
                cluster.extensions.forEach(ext => {
                    if (ext.topAPIs.some(a => a.api === mv2API)) {
                        extensionsUsing.push({
                            name: ext.name,
                            cluster: cluster.name || \`Cluster \${cluster.id}\`,
                            source: ext.source
                        });
                    }
                });
            });
            
            return {
                mv2API,
                mv3API: info.mv3,
                status: info.status,
                count: extensionsUsing.length,
                extensions: extensionsUsing
            };
        }).filter(api => api.count > 0);
        
        const apiCoverageContainer = document.getElementById('api-coverage');
        if (apiCoverage.length === 0) {
            apiCoverageContainer.innerHTML = '<p style="color: #30cfd0; padding: 20px;">✓ No deprecated MV2 APIs detected in dataset!</p>';
        } else {
            apiCoverageContainer.innerHTML = \`
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #1a1a1a; border-bottom: 2px solid #333;">
                            <th style="padding: 12px; text-align: left;">MV2 API (Deprecated)</th>
                            <th style="padding: 12px; text-align: left;">MV3 Replacement</th>
                            <th style="padding: 12px; text-align: center;">Status</th>
                            <th style="padding: 12px; text-align: center;">Extensions Using</th>
                        </tr>
                    </thead>
                    <tbody>
                        \${apiCoverage.map(api => \`
                            <tr style="border-bottom: 1px solid #222;">
                                <td style="padding: 12px;">
                                    <code style="color: #fa709a; background: #1a1a1a; padding: 4px 8px; border-radius: 4px;">
                                        \${api.mv2API}
                                    </code>
                                </td>
                                <td style="padding: 12px;">
                                    <code style="color: #30cfd0; background: #1a1a1a; padding: 4px 8px; border-radius: 4px;">
                                        \${api.mv3API}
                                    </code>
                                </td>
                                <td style="padding: 12px; text-align: center;">
                                    <span class="badge" style="background: \${api.status === 'deprecated' ? '#fa709a' : '#f093fb'}; color: white;">
                                        \${api.status}
                                    </span>
                                </td>
                                <td style="padding: 12px; text-align: center;">
                                    <strong style="color: #fff;">\${api.count}</strong>
                                    <button 
                                        onclick="showAPIDetails('\${api.mv2API}', \${JSON.stringify(api.extensions)})"
                                        style="margin-left: 8px; padding: 4px 12px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
                                        View
                                    </button>
                                </td>
                            </tr>
                        \`).join('')}
                    </tbody>
                </table>
            \`;
        }
        
        // Render edge cases
        const edgeCasesContainer = document.getElementById('edge-cases');
        if (edgeCases.length === 0) {
            edgeCasesContainer.innerHTML = '<p style="color: #30cfd0; padding: 20px;">✓ No obvious edge cases detected!</p>';
        } else {
            edgeCasesContainer.innerHTML = \`
                <div style="margin-bottom: 15px; color: #888;">
                    Found \${edgeCases.length} potential edge case\${edgeCases.length !== 1 ? 's' : ''} that may need special attention
                </div>
                \${edgeCases.map(ec => \`
                    <div style="background: #1a1a1a; padding: 15px; margin: 10px 0; border-radius: 8px; border-left: 4px solid \${ec.severity === 'high' ? '#fa709a' : '#f093fb'};">
                        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                            <div>
                                <strong style="color: #fff;">\${ec.extension.name}</strong>
                                <div style="font-size: 0.85rem; color: #666; margin-top: 4px;">in \${ec.cluster}</div>
                            </div>
                            <span class="badge" style="background: \${ec.severity === 'high' ? '#fa709a' : '#f093fb'}; color: white;">
                                \${ec.severity}
                            </span>
                        </div>
                        <div style="color: #aaa; font-size: 0.9rem; margin-bottom: 8px;">
                            ⚠️ \${ec.reason}
                        </div>
                        <div style="font-size: 0.85rem; color: #888;">
                            \${ec.apis.map(api => \`<code style="background: #0f0f0f; padding: 2px 6px; border-radius: 3px; margin-right: 4px;">\${api.replace('chrome.', '')}</code>\`).join('')}
                        </div>
                    </div>
                \`).join('')}
            \`;
        }
        
        // Render cluster cards
        const clustersContainer = document.getElementById('clusters');
        clusterData.forEach((cluster, idx) => {
            const card = document.createElement('div');
            card.className = 'cluster-card';
            card.style.borderColor = colors[idx % colors.length];
            
            const commonAPIsHtml = cluster.commonAPIs.slice(0, 5).map(api => 
                \`<li>\${api.replace('chrome.', '')}</li>\`
            ).join('');
            
            // Count extensions with issues
            const issueCount = edgeCases.filter(ec => 
                cluster.extensions.some(e => e.id === ec.extension.id)
            ).length;
            
            card.innerHTML = \`
                <h3 style="color: \${colors[idx % colors.length]}">\${cluster.name || 'Cluster ' + cluster.id}</h3>
                <div class="cluster-size">
                    \${cluster.size} extension\${cluster.size !== 1 ? 's' : ''}
                    \${issueCount > 0 ? \`<span style="color: #fa709a; margin-left: 8px;">⚠️ \${issueCount} edge case\${issueCount !== 1 ? 's' : ''}</span>\` : ''}
                </div>
                <div style="margin-bottom: 10px; color: #888; font-size: 0.9rem;">Common APIs:</div>
                <ul class="api-list">
                    \${commonAPIsHtml || '<li style="color: #666;">No common APIs</li>'}
                </ul>
            \`;
            
            card.onclick = () => showClusterDetails(cluster, colors[idx % colors.length]);
            clustersContainer.appendChild(card);
        });
        
        // Modal functionality
        const modal = document.getElementById('extensionModal');
        const span = document.getElementsByClassName('close')[0];
        
        span.onclick = () => modal.style.display = 'none';
        window.onclick = (event) => {
            if (event.target == modal) modal.style.display = 'none';
        };
        
        function showAPIDetails(apiName, extensions) {
            const modal = document.getElementById('extensionModal');
            const content = \`
                <h2 style="color: #fa709a; margin-bottom: 20px;">Extensions using \${apiName}</h2>
                <p style="color: #888; margin-bottom: 20px;">
                    These extensions still use the deprecated MV2 API and may need migration work.
                </p>
                \${extensions.map(ext => \`
                    <div class="extension-item">
                        <div>
                            <strong>\${ext.name}</strong>
                            <div style="font-size: 0.75rem; color: #666; margin-top: 4px;">
                                Cluster: \${ext.cluster}
                            </div>
                        </div>
                        <span class="badge badge-\${ext.source}">\${ext.source}</span>
                    </div>
                \`).join('')}
            \`;
            
            document.getElementById('modalContent').innerHTML = content;
            modal.style.display = 'block';
        }
        
        function showClusterDetails(cluster, color) {
            const extensionsHtml = cluster.extensions.map(ext => {
                const topAPIsHtml = ext.topAPIs.map(api => 
                    \`<tr><td>\${api.api.replace('chrome.', '')}</td><td>\${api.count}</td></tr>\`
                ).join('');
                
                return \`
                    <div class="extension-item">
                        <div>
                            <strong>\${ext.name}</strong>
                            <div style="font-size: 0.75rem; color: #666; margin-top: 4px;">
                                ID: \${ext.id}
                            </div>
                        </div>
                        <div>
                            <span class="badge badge-\${ext.source}">\${ext.source}</span>
                            <span class="badge badge-mv\${ext.manifestVersion}">MV\${ext.manifestVersion}</span>
                        </div>
                    </div>
                    <div style="margin: 10px 0 20px 0; padding: 10px; background: #0f0f0f; border-radius: 4px;">
                        <table style="width: 100%; font-size: 0.85rem;">
                            <thead>
                                <tr style="color: #888; border-bottom: 1px solid #333;">
                                    <th style="text-align: left; padding: 4px;">API</th>
                                    <th style="text-align: right; padding: 4px;">Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                \${topAPIsHtml}
                            </tbody>
                        </table>
                    </div>
                \`;
            }).join('');
            
            document.getElementById('modalContent').innerHTML = \`
                <h2 style="color: \${color}; margin-bottom: 20px;">\${cluster.name || 'Cluster ' + cluster.id}</h2>
                <div style="margin-bottom: 20px;">
                    <strong style="color: #888;">Common APIs:</strong>
                    <div style="margin-top: 10px;">
                        \${cluster.commonAPIs.map(api => 
                            \`<span style="display: inline-block; padding: 4px 12px; margin: 4px; background: #0f0f0f; border-radius: 4px; font-size: 0.85rem;">\${api.replace('chrome.', '')}</span>\`
                        ).join('')}
                    </div>
                </div>
                <h3 style="margin: 20px 0 10px 0;">Extensions in this cluster:</h3>
                \${extensionsHtml}
            \`;
            
            modal.style.display = 'block';
        }
    </script>
</body>
</html>`;

    fs.writeFileSync(outputFile, html);
    console.log(chalk.green(`✓ Visualization saved to ${outputFile}`));
}

/**
 * Main function
 */
async function main() {
    console.log(chalk.bold.cyan('\n🔬 Extension API Clustering Tool\n'));

    const args = process.argv.slice(2);

    // Auto-detect from .env file
    const envInputPath = process.env.INPUT_DIR;
    const envOutputPath = process.env.OUTPUT_DIR;
    const envMongoUri = process.env.MONGODB_URI;

    // Parse command line arguments (override .env if provided)
    let inputPath: string | null = null;
    let outputPath: string | null = null;
    let useDatabase = false;
    let numClusters = 5;
    let visualizationFile = './cluster_visualization.html';
    let autoMode = false; // Use .env automatically

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--input' || args[i] === '-i') {
            inputPath = args[++i];
        } else if (args[i] === '--output' || args[i] === '-o') {
            outputPath = args[++i];
        } else if (args[i] === '--database' || args[i] === '-d') {
            useDatabase = true;
        } else if (args[i] === '--auto' || args[i] === '-a') {
            autoMode = true;
        } else if (args[i] === '--clusters' || args[i] === '-c') {
            numClusters = parseInt(args[++i]);
        } else if (args[i] === '--viz' || args[i] === '-v') {
            visualizationFile = args[++i];
        } else if (args[i] === '--help' || args[i] === '-h') {
            console.log(`
Usage: npm run cluster [-- options]

The tool automatically detects input/output directories from .env file.

Options:
  -a, --auto               Use .env settings (INPUT_DIR, OUTPUT_DIR, MONGODB_URI)
  -i, --input <path>       Path to input extensions directory (overrides .env)
  -o, --output <path>      Path to migrated extensions output directory (overrides .env)
  -d, --database           Load extensions from MongoDB database
  -c, --clusters <num>     Number of clusters (default: 5)
  -v, --viz <file>         Output HTML file for visualization (default: ./cluster_visualization.html)
  -h, --help               Show this help message

Environment Variables (from .env):
  INPUT_DIR=${envInputPath || 'not set'}
  OUTPUT_DIR=${envOutputPath || 'not set'}
  MONGODB_URI=${envMongoUri ? 'configured' : 'not set'}

Examples:
  # Auto-detect everything from .env (recommended)
  npm run cluster

  # Auto-detect with custom cluster count
  npm run cluster -- --clusters 10

  # Use .env paths explicitly
  npm run cluster -- --auto

  # Override .env with specific path
  npm run cluster -- --input ./my-extensions

  # Compare .env input vs output
  npm run cluster -- --auto --database

  # Manual paths (ignores .env)
  npm run cluster -- --input ./extensions --output ./tmp/output --database
            `);
            process.exit(0);
        }
    }

    // Apply .env defaults if not explicitly provided
    if (!inputPath && !outputPath && !useDatabase) {
        // No arguments provided - use .env automatically
        autoMode = true;
    }

    if (autoMode) {
        console.log(chalk.blue('Using configuration from .env file...'));

        if (!inputPath && envInputPath) {
            inputPath = envInputPath;
            console.log(chalk.gray(`  INPUT_DIR: ${envInputPath}`));
        }

        if (!outputPath && envOutputPath) {
            outputPath = envOutputPath;
            console.log(chalk.gray(`  OUTPUT_DIR: ${envOutputPath}`));
        }

        if (!useDatabase && envMongoUri) {
            useDatabase = true;
            console.log(chalk.gray(`  MONGODB_URI: configured`));
        }

        console.log('');
    }

    // Load extensions from all sources
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

        if (!envInputPath && !envOutputPath && !envMongoUri) {
            console.log(chalk.yellow('No paths configured in .env file.'));
            console.log(chalk.gray('Please set INPUT_DIR, OUTPUT_DIR, or MONGODB_URI in .env\n'));
        }

        console.log(chalk.gray('Specify at least one source:'));
        console.log(chalk.gray('  --input <path>   - Load from filesystem'));
        console.log(chalk.gray('  --output <path>  - Load from output directory'));
        console.log(chalk.gray('  --database       - Load from MongoDB'));
        console.log(chalk.gray('  --auto           - Use .env configuration\n'));

        process.exit(1);
    }

    // Auto-adjust number of clusters if needed
    if (numClusters > allExtensions.length) {
        numClusters = Math.max(1, Math.floor(allExtensions.length / 2));
        console.log(
            chalk.yellow(`Adjusting cluster count to ${numClusters} based on number of extensions`)
        );
    }

    // Perform clustering
    const clusters = clusterExtensions(allExtensions, numClusters);

    // Generate visualization
    generateVisualization(clusters, allExtensions, visualizationFile);

    // Print summary
    console.log(chalk.bold.cyan('\n📊 Clustering Summary:\n'));
    clusters.forEach((cluster) => {
        console.log(chalk.bold(`${cluster.clusterName} (Cluster ${cluster.clusterId}):`));
        console.log(`  Extensions: ${cluster.extensions.length}`);
        console.log(`  Common APIs: ${cluster.commonAPIs.slice(0, 3).join(', ')}`);
        console.log('');
    });

    console.log(
        chalk.bold.green(
            `\n✓ Done! Open ${visualizationFile} in your browser to view the visualization.\n`
        )
    );

    // Close database connection
    if (useDatabase) {
        await Database.shared.close();
    }
}

// Run main function
main().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});
