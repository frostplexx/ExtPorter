/**
 * HTML visualization generator for clustering results
 */

import * as fs from 'fs';
import { ExtensionData, ClusterResult, APIDomainStats } from './types';
import { needsMigration, identifyEdgeCaseAPIs } from './clustering_utils';
import { OverallStats, ClusterStats } from './output_formatter';
import {
    matchMigrationPairs,
    compareMigration,
    calculateMigrationStats,
    getTopMigrations,
    getProblematicMigrations,
} from './migration_comparison';

/**
 * Generate HTML visualization with all clustering results
 */
export function generateHTMLVisualization(
    outputPath: string,
    extensions: ExtensionData[],
    clusters: ClusterResult[],
    apiDomains: APIDomainStats[],
    overallStats: OverallStats,
    clusterStats: ClusterStats[],
    idMappings?: Map<string, string>
): void {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Extension Clustering Analysis</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        
        .container {
            max-width: 1400px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        h1 {
            color: #2c3e50;
            margin-bottom: 30px;
            padding-bottom: 20px;
            border-bottom: 3px solid #3498db;
            font-size: 2.5em;
        }
        
        h2 {
            color: #2c3e50;
            margin-top: 40px;
            margin-bottom: 20px;
            font-size: 1.8em;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        
        h3 {
            color: #34495e;
            margin-top: 25px;
            margin-bottom: 15px;
            font-size: 1.3em;
        }
        
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 30px 0;
        }
        
        .stat-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 25px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        
        .stat-card.green {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }
        
        .stat-card.orange {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        
        .stat-card.blue {
            background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
        }
        
        .stat-label {
            font-size: 0.9em;
            opacity: 0.9;
            margin-bottom: 5px;
        }
        
        .stat-value {
            font-size: 2.5em;
            font-weight: bold;
        }
        
        .stat-subtitle {
            font-size: 0.85em;
            opacity: 0.85;
            margin-top: 5px;
        }
        
        .cluster {
            background: #f8f9fa;
            border-left: 4px solid #3498db;
            padding: 20px;
            margin: 15px 0;
            border-radius: 5px;
        }
        
        .cluster-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
        }
        
        .cluster-name {
            font-size: 1.3em;
            font-weight: bold;
            color: #2c3e50;
        }
        
        .cluster-badge {
            padding: 5px 15px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: bold;
        }
        
        .badge-simple { background: #d4edda; color: #155724; }
        .badge-moderate { background: #fff3cd; color: #856404; }
        .badge-complex { background: #f8d7da; color: #721c24; }
        
        .cluster-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin: 15px 0;
        }
        
        .cluster-stat {
            background: white;
            padding: 10px;
            border-radius: 5px;
            text-align: center;
        }
        
        .cluster-stat-label {
            font-size: 0.85em;
            color: #666;
        }
        
        .cluster-stat-value {
            font-size: 1.5em;
            font-weight: bold;
            color: #2c3e50;
        }
        
        .api-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }
        
        .api-tag {
            background: #e3f2fd;
            color: #1976d2;
            padding: 5px 12px;
            border-radius: 15px;
            font-size: 0.85em;
        }
        
        .api-tag.deprecated {
            background: #ffebee;
            color: #c62828;
        }
        
        .migration-section {
            background: #fff3e0;
            border: 2px solid #ff9800;
            border-radius: 8px;
            padding: 25px;
            margin: 20px 0;
        }
        
        .migration-api {
            background: white;
            border-left: 4px solid #f44336;
            padding: 15px;
            margin: 10px 0;
            border-radius: 4px;
        }
        
        .migration-api-name {
            font-weight: bold;
            color: #c62828;
            font-size: 1.1em;
            margin-bottom: 5px;
        }
        
        .migration-stats {
            color: #666;
            font-size: 0.9em;
        }
        
        .extension-list {
            margin-top: 15px;
            padding-left: 20px;
        }
        
        .extension-item {
            margin: 8px 0;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
        }
        
        .extension-name {
            font-weight: 600;
            color: #2c3e50;
        }
        
        .extension-apis {
            font-size: 0.85em;
            color: #666;
            margin-top: 5px;
        }
        
        .severity-badge {
            display: inline-block;
            padding: 3px 10px;
            border-radius: 12px;
            font-size: 0.75em;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .severity-high { background: #f44336; color: white; }
        .severity-medium { background: #ff9800; color: white; }
        .severity-low { background: #2196f3; color: white; }
        
        .edge-case {
            background: white;
            border-left: 4px solid #ff5722;
            padding: 15px;
            margin: 12px 0;
            border-radius: 4px;
        }
        
        .edge-case-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .api-domain {
            background: #f5f5f5;
            border-radius: 6px;
            padding: 15px;
            margin: 10px 0;
        }
        
        .api-domain-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .api-domain-name {
            font-weight: bold;
            font-size: 1.1em;
            color: #2c3e50;
        }
        
        .warning-icon { color: #f44336; font-weight: bold; }
        .success-icon { color: #4caf50; font-weight: bold; }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        
        th {
            background: #f5f5f5;
            font-weight: 600;
            color: #2c3e50;
        }
        
        tr:hover {
            background: #f9f9f9;
        }
        
        .insight-box {
            background: #e8f5e9;
            border-left: 4px solid #4caf50;
            padding: 20px;
            margin: 15px 0;
            border-radius: 4px;
        }
        
        .insight-box ul {
            margin-left: 20px;
            margin-top: 10px;
        }
        
        .insight-box li {
            margin: 8px 0;
        }
        
        @media print {
            body {
                background: white;
                padding: 0;
            }
            .container {
                box-shadow: none;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔬 Extension Clustering Analysis Report</h1>
        
        ${generateOverviewSection(overallStats)}
        ${generateMigrationComparisonSection(extensions, idMappings)}
        ${generateClusterSection(clusters, clusterStats)}
        ${generateAPIDomainSection(apiDomains)}
        ${generateMigrationSection(extensions, apiDomains)}
        ${generateEdgeCaseSection(extensions)}
        ${generateInsightsSection(overallStats, clusterStats, apiDomains)}
    </div>
</body>
</html>`;

    fs.writeFileSync(outputPath, html, 'utf-8');
    console.log(`\n✓ HTML visualization saved to: ${outputPath}\n`);
}

function generateMigrationComparisonSection(
    extensions: ExtensionData[],
    idMappings?: Map<string, string>
): string {
    // Separate MV2 and MV3 extensions
    const mv2Extensions = extensions.filter(
        (e) => e.source === 'filesystem' || e.source === 'database'
    );
    const mv3Extensions = extensions.filter((e) => e.source === 'output');

    if (mv2Extensions.length === 0 || mv3Extensions.length === 0) {
        return `
            <section id="migration-comparison">
                <h2>🔄 Migration Comparison</h2>
                <div class="insight-box">
                    <p>⚠️ Migration comparison unavailable.</p>
                    <p>Both MV2 (input) and MV3 (output) extensions are needed for comparison.</p>
                </div>
            </section>
        `;
    }

    const pairs = matchMigrationPairs(mv2Extensions, mv3Extensions, idMappings);

    if (pairs.length === 0) {
        return `
            <section id="migration-comparison">
                <h2>🔄 Migration Comparison</h2>
                <div class="insight-box">
                    <p>⚠️ No matching extension pairs found.</p>
                    <p>Ensure MV2 and MV3 extensions have matching IDs.</p>
                </div>
            </section>
        `;
    }

    const comparisons = pairs.map((pair) => compareMigration(pair));
    const stats = calculateMigrationStats(comparisons);
    const topMigrations = getTopMigrations(comparisons, 10);
    const problematic = getProblematicMigrations(comparisons, 10);

    return `
        <section id="migration-comparison">
            <h2>🔄 Migration Comparison Analysis</h2>
            <p>Comparing ${pairs.length} matched MV2/MV3 extension pairs</p>
            
            <div class="stats-grid">
                <div class="stat-card green">
                    <div class="stat-label">Successful Migrations</div>
                    <div class="stat-value">${stats.successfulMigrations}</div>
                    <div class="stat-subtitle">${((stats.successfulMigrations / stats.totalPairs) * 100).toFixed(1)}% of total</div>
                </div>
                <div class="stat-card ${stats.failedMigrations > 0 ? 'orange' : 'green'}">
                    <div class="stat-label">Failed Migrations</div>
                    <div class="stat-value">${stats.failedMigrations}</div>
                    <div class="stat-subtitle">${((stats.failedMigrations / stats.totalPairs) * 100).toFixed(1)}% of total</div>
                </div>
                <div class="stat-card blue">
                    <div class="stat-label">Avg API Reduction</div>
                    <div class="stat-value">${stats.averageApiReduction.toFixed(1)}%</div>
                </div>
                <div class="stat-card blue">
                    <div class="stat-label">Avg Call Reduction</div>
                    <div class="stat-value">${stats.averageCallReduction.toFixed(1)}%</div>
                </div>
            </div>
            
            <h3>Migration Quality Breakdown</h3>
            <table>
                <tr>
                    <th>Quality</th>
                    <th>Count</th>
                    <th>Percentage</th>
                    <th>Description</th>
                </tr>
                <tr style="background: #e8f5e9;">
                    <td><strong>Excellent</strong></td>
                    <td>${stats.excellent}</td>
                    <td>${((stats.excellent / stats.totalPairs) * 100).toFixed(1)}%</td>
                    <td>All deprecated APIs resolved</td>
                </tr>
                <tr style="background: #f1f8e9;">
                    <td><strong>Good</strong></td>
                    <td>${stats.good}</td>
                    <td>${((stats.good / stats.totalPairs) * 100).toFixed(1)}%</td>
                    <td>≥80% deprecated APIs resolved</td>
                </tr>
                <tr style="background: #fff3e0;">
                    <td><strong>Poor</strong></td>
                    <td>${stats.poor}</td>
                    <td>${((stats.poor / stats.totalPairs) * 100).toFixed(1)}%</td>
                    <td>Some APIs resolved, but many remain</td>
                </tr>
                <tr style="background: #ffebee;">
                    <td><strong>Failed</strong></td>
                    <td>${stats.failed}</td>
                    <td>${((stats.failed / stats.totalPairs) * 100).toFixed(1)}%</td>
                    <td>No deprecated APIs resolved</td>
                </tr>
            </table>
            
            <h3>Most Common API Migrations</h3>
            <p>These API transformations occurred most frequently:</p>
            <table>
                <tr>
                    <th>From (MV2)</th>
                    <th></th>
                    <th>To (MV3)</th>
                    <th>Count</th>
                </tr>
                ${stats.mostMigratedAPIs
                    .map(
                        (migration) => `
                    <tr>
                        <td><code>${migration.from}</code></td>
                        <td style="text-align: center;">→</td>
                        <td><code>${migration.to}</code></td>
                        <td>${migration.count}</td>
                    </tr>
                `
                    )
                    .join('')}
            </table>
            
            ${
                stats.unmappedAPIs.length > 0
                    ? `
                <h3>⚠️ Unmapped/Unresolved APIs</h3>
                <p>These APIs were removed but no MV3 equivalent was detected:</p>
                <div class="migration-section">
                    ${stats.unmappedAPIs
                        .map(
                            (unmapped) => `
                        <div class="migration-api">
                            <div class="migration-api-name">${unmapped.api}</div>
                            <div class="migration-stats">Removed in ${unmapped.count} extension(s) without clear replacement</div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            `
                    : ''
            }
            
            ${
                topMigrations.length > 0
                    ? `
                <h3>✅ Best Migration Examples</h3>
                <p>Extensions that successfully migrated the most APIs:</p>
                <div class="extension-list">
                    ${topMigrations
                        .map(
                            (comp) => `
                        <div class="extension-item" style="border-left: 4px solid #4caf50;">
                            <div class="extension-name">${comp.name}</div>
                            <div class="extension-apis">
                                <strong>${comp.apisMigrated.length} APIs migrated:</strong>
                                ${comp.apisMigrated
                                    .slice(0, 5)
                                    .map((m) => `<br/>&nbsp;&nbsp;• ${m.from} → ${m.to}`)
                                    .join('')}
                                ${comp.apisMigrated.length > 5 ? `<br/>&nbsp;&nbsp;... and ${comp.apisMigrated.length - 5} more` : ''}
                            </div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            `
                    : ''
            }
            
            ${
                problematic.length > 0
                    ? `
                <h3>❌ Migrations Needing Attention</h3>
                <p>Extensions with incomplete migrations:</p>
                <div class="extension-list">
                    ${problematic
                        .map(
                            (comp) => `
                        <div class="extension-item" style="border-left: 4px solid #f44336;">
                            <div class="extension-name">${comp.name}</div>
                            <div class="extension-apis" style="color: #c62828;">
                                <strong>${comp.deprecatedAPIsRemaining} deprecated APIs remaining</strong>
                                ${comp.apisRemoved
                                    .filter((api: string) => needsMigration(api))
                                    .slice(0, 5)
                                    .join(', ')}
                            </div>
                        </div>
                    `
                        )
                        .join('')}
                </div>
            `
                    : ''
            }
        </section>
    `;
}

function generateOverviewSection(stats: OverallStats): string {
    return `
        <section id="overview">
            <h2>📊 Dataset Overview</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-label">Total Extensions</div>
                    <div class="stat-value">${stats.totalExtensions.toLocaleString()}</div>
                </div>
                <div class="stat-card green">
                    <div class="stat-label">Total API Calls</div>
                    <div class="stat-value">${stats.totalApiCalls.toLocaleString()}</div>
                    <div class="stat-subtitle">Avg: ${stats.avgCallsPerExtension.toFixed(0)} per ext</div>
                </div>
                <div class="stat-card blue">
                    <div class="stat-label">Unique APIs</div>
                    <div class="stat-value">${stats.uniqueAPIs}</div>
                    <div class="stat-subtitle">Avg: ${stats.avgApisPerExtension.toFixed(1)} per ext</div>
                </div>
                <div class="stat-card orange">
                    <div class="stat-label">Need Migration</div>
                    <div class="stat-value">${stats.migrationNeeded}</div>
                    <div class="stat-subtitle">${stats.migrationPercentage.toFixed(1)}% of total</div>
                </div>
            </div>
            
            <h3>Sources</h3>
            <table>
                <tr>
                    <th>Source</th>
                    <th>Count</th>
                    <th>Percentage</th>
                </tr>
                ${stats.sources.filesystem > 0 ? `<tr><td>Filesystem</td><td>${stats.sources.filesystem}</td><td>${((stats.sources.filesystem / stats.totalExtensions) * 100).toFixed(1)}%</td></tr>` : ''}
                ${stats.sources.database > 0 ? `<tr><td>Database</td><td>${stats.sources.database}</td><td>${((stats.sources.database / stats.totalExtensions) * 100).toFixed(1)}%</td></tr>` : ''}
                ${stats.sources.output > 0 ? `<tr><td>Output</td><td>${stats.sources.output}</td><td>${((stats.sources.output / stats.totalExtensions) * 100).toFixed(1)}%</td></tr>` : ''}
            </table>
            
            <h3>Manifest Versions</h3>
            <table>
                <tr>
                    <th>Version</th>
                    <th>Count</th>
                    <th>Percentage</th>
                </tr>
                <tr>
                    <td>Manifest V2</td>
                    <td>${stats.manifestVersions.mv2}</td>
                    <td>${((stats.manifestVersions.mv2 / stats.totalExtensions) * 100).toFixed(1)}%</td>
                </tr>
                <tr>
                    <td>Manifest V3</td>
                    <td>${stats.manifestVersions.mv3}</td>
                    <td>${((stats.manifestVersions.mv3 / stats.totalExtensions) * 100).toFixed(1)}%</td>
                </tr>
            </table>
        </section>
    `;
}

function generateClusterSection(clusters: ClusterResult[], stats: ClusterStats[]): string {
    const sortedStats = [...stats].sort((a, b) => b.size - a.size);

    return `
        <section id="clusters">
            <h2>📦 Cluster Analysis</h2>
            <p>Extensions grouped by common API usage patterns</p>
            
            ${sortedStats
                .map((stat, index) => {
                    return `
                    <div class="cluster">
                        <div class="cluster-header">
                            <span class="cluster-name">${index + 1}. ${stat.name}</span>
                            <span class="cluster-badge badge-${stat.complexity}">${stat.complexity.toUpperCase()}</span>
                        </div>
                        
                        <div class="cluster-stats">
                            <div class="cluster-stat">
                                <div class="cluster-stat-label">Extensions</div>
                                <div class="cluster-stat-value">${stat.size}</div>
                            </div>
                            <div class="cluster-stat">
                                <div class="cluster-stat-label">Percentage</div>
                                <div class="cluster-stat-value">${stat.percentage.toFixed(1)}%</div>
                            </div>
                            <div class="cluster-stat">
                                <div class="cluster-stat-label">Avg API Calls</div>
                                <div class="cluster-stat-value">${stat.avgApiCalls}</div>
                            </div>
                            <div class="cluster-stat">
                                <div class="cluster-stat-label">MV2</div>
                                <div class="cluster-stat-value">${stat.mv2Count}</div>
                            </div>
                            <div class="cluster-stat">
                                <div class="cluster-stat-label">MV3</div>
                                <div class="cluster-stat-value">${stat.mv3Count}</div>
                            </div>
                        </div>
                        
                        <div>
                            <strong>Common APIs:</strong>
                            <div class="api-list">
                                ${stat.topApis.map((api) => `<span class="api-tag">${api}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                `;
                })
                .join('')}
        </section>
    `;
}

function generateAPIDomainSection(apiDomains: APIDomainStats[]): string {
    return `
        <section id="api-domains">
            <h2>🔌 API Domain Analysis</h2>
            <p>Top ${Math.min(15, apiDomains.length)} most-used API domains</p>
            
            ${apiDomains
                .slice(0, 15)
                .map(
                    (domain, index) => `
                <div class="api-domain">
                    <div class="api-domain-header">
                        <span class="api-domain-name">${index + 1}. ${domain.domain}</span>
                        ${
                            domain.unmigrated > 0
                                ? `<span class="warning-icon">⚠️ ${domain.unmigrated} need migration</span>`
                                : `<span class="success-icon">✓</span>`
                        }
                    </div>
                    <p><strong>Extensions:</strong> ${domain.totalExtensions} | <strong>Total Calls:</strong> ${domain.totalCalls.toLocaleString()}</p>
                    <div>
                        <strong>Top APIs:</strong>
                        <div class="api-list">
                            ${domain.apis
                                .slice(0, 5)
                                .map((api) => {
                                    const shortName = api.api.replace(domain.domain + '.', '');
                                    return `<span class="api-tag ${api.needsMigration ? 'deprecated' : ''}">${shortName} (${api.extensionCount})</span>`;
                                })
                                .join('')}
                        </div>
                    </div>
                </div>
            `
                )
                .join('')}
        </section>
    `;
}

function generateMigrationSection(
    extensions: ExtensionData[],
    _apiDomains: APIDomainStats[]
): string {
    const extensionsNeedingMigration = extensions.filter((ext) =>
        Object.keys(ext.fullApiUsage).some((api) => needsMigration(api))
    );

    if (extensionsNeedingMigration.length === 0) {
        return `
            <section id="migration">
                <h2>⚠️ Migration Recommendations</h2>
                <div class="insight-box">
                    <p><strong>✅ No migration needed!</strong> All extensions use MV3-compatible APIs.</p>
                </div>
            </section>
        `;
    }

    // Count deprecated APIs
    const deprecatedApiCounts = new Map<string, number>();
    for (const ext of extensionsNeedingMigration) {
        for (const api of Object.keys(ext.fullApiUsage)) {
            if (needsMigration(api) && ext.fullApiUsage[api] > 0) {
                deprecatedApiCounts.set(api, (deprecatedApiCounts.get(api) || 0) + 1);
            }
        }
    }

    const sortedDeprecated = Array.from(deprecatedApiCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

    // Sort extensions by deprecated API count
    const sortedExtensions = extensionsNeedingMigration
        .map((ext) => ({
            ext,
            deprecatedCount: Object.keys(ext.fullApiUsage).filter(
                (api) => needsMigration(api) && ext.fullApiUsage[api] > 0
            ).length,
            deprecatedApis: Object.keys(ext.fullApiUsage).filter(
                (api) => needsMigration(api) && ext.fullApiUsage[api] > 0
            ),
        }))
        .sort((a, b) => b.deprecatedCount - a.deprecatedCount)
        .slice(0, 20);

    return `
        <section id="migration">
            <h2>⚠️ Migration Recommendations</h2>
            <div class="migration-section">
                <p><strong>${extensionsNeedingMigration.length}</strong> extensions need MV2→MV3 migration (${((extensionsNeedingMigration.length / extensions.length) * 100).toFixed(1)}% of total)</p>
            </div>
            
            <h3>Most Common Deprecated APIs</h3>
            ${sortedDeprecated
                .map(([api, count]) => {
                    const percentage = ((count / extensionsNeedingMigration.length) * 100).toFixed(
                        1
                    );
                    return `
                    <div class="migration-api">
                        <div class="migration-api-name">${api}</div>
                        <div class="migration-stats">Used in ${count} extensions (${percentage}%)</div>
                    </div>
                `;
                })
                .join('')}
            
            <h3>Priority Extensions (Top 20)</h3>
            <p>Extensions ranked by number of deprecated APIs used</p>
            <div class="extension-list">
                ${sortedExtensions
                    .map(
                        ({ ext, deprecatedCount, deprecatedApis }) => `
                    <div class="extension-item">
                        <div class="extension-name">${ext.name} <span style="color: #c62828;">(${deprecatedCount} deprecated APIs)</span></div>
                        <div class="extension-apis">Uses: ${deprecatedApis.slice(0, 5).join(', ')}${deprecatedApis.length > 5 ? ` ... +${deprecatedApis.length - 5} more` : ''}</div>
                    </div>
                `
                    )
                    .join('')}
            </div>
            
            ${extensionsNeedingMigration.length > 20 ? `<p><em>... and ${extensionsNeedingMigration.length - 20} more extensions</em></p>` : ''}
        </section>
    `;
}

function generateEdgeCaseSection(extensions: ExtensionData[]): string {
    const edgeCases = identifyEdgeCaseAPIs(extensions);

    if (edgeCases.length === 0) {
        return '';
    }

    const high = edgeCases.filter((e) => e.severity === 'high');
    const medium = edgeCases.filter((e) => e.severity === 'medium');
    const low = edgeCases.filter((e) => e.severity === 'low');

    return `
        <section id="edge-cases">
            <h2>⚠️ Edge Case APIs</h2>
            <p>APIs that may require special attention during migration</p>
            
            ${
                high.length > 0
                    ? `
                <h3>High Severity</h3>
                ${high
                    .map(
                        (edge) => `
                    <div class="edge-case">
                        <div class="edge-case-header">
                            <strong>${edge.api}</strong>
                            <span class="severity-badge severity-high">High</span>
                        </div>
                        <p>${edge.reason}</p>
                        <p style="color: #666; margin-top: 8px;">Affects <strong>${edge.extensionCount}</strong> extension(s)</p>
                    </div>
                `
                    )
                    .join('')}
            `
                    : ''
            }
            
            ${
                medium.length > 0
                    ? `
                <h3>Medium Severity</h3>
                ${medium
                    .map(
                        (edge) => `
                    <div class="edge-case">
                        <div class="edge-case-header">
                            <strong>${edge.api}</strong>
                            <span class="severity-badge severity-medium">Medium</span>
                        </div>
                        <p>${edge.reason}</p>
                        <p style="color: #666; margin-top: 8px;">Affects <strong>${edge.extensionCount}</strong> extension(s)</p>
                    </div>
                `
                    )
                    .join('')}
            `
                    : ''
            }
            
            ${
                low.length > 0
                    ? `
                <h3>Low Severity</h3>
                ${low
                    .map(
                        (edge) => `
                    <div class="edge-case">
                        <div class="edge-case-header">
                            <strong>${edge.api}</strong>
                            <span class="severity-badge severity-low">Low</span>
                        </div>
                        <p>${edge.reason}</p>
                        <p style="color: #666; margin-top: 8px;">Affects <strong>${edge.extensionCount}</strong> extension(s)</p>
                    </div>
                `
                    )
                    .join('')}
            `
                    : ''
            }
        </section>
    `;
}

function generateInsightsSection(
    stats: OverallStats,
    clusterStats: ClusterStats[],
    apiDomains: APIDomainStats[]
): string {
    const insights: string[] = [];

    const largestCluster = clusterStats.reduce((max, c) => (c.size > max.size ? c : max));
    const complexClusters = clusterStats.filter((c) => c.complexity === 'complex').length;

    insights.push(
        `Largest cluster: "${largestCluster.name}" with ${largestCluster.size} extensions (${largestCluster.percentage.toFixed(1)}%)`
    );

    if (complexClusters > 0) {
        insights.push(
            `${complexClusters} cluster(s) marked as complex - may require extra migration effort`
        );
    }

    const mostUsedDomain = apiDomains[0];
    if (mostUsedDomain) {
        insights.push(
            `Most popular API: ${mostUsedDomain.domain} used in ${mostUsedDomain.totalExtensions} extensions`
        );
    }

    if (stats.migrationPercentage > 0) {
        insights.push(`${stats.migrationPercentage.toFixed(1)}% of extensions need migration`);
    }

    if (stats.manifestVersions.mv3 > 0) {
        insights.push(
            `Dataset includes ${stats.manifestVersions.mv3} MV3 extensions - useful for comparison`
        );
    }

    return `
        <section id="insights">
            <h2>💡 Key Insights</h2>
            <div class="insight-box">
                <ul>
                    ${insights.map((insight) => `<li>${insight}</li>`).join('')}
                </ul>
            </div>
        </section>
    `;
}
