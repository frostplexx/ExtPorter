/**
 * Enhanced output formatting and statistics for clustering results
 */

import chalk from 'chalk';
import { ExtensionData, ClusterResult, APIDomainStats } from './types';
import { needsMigration, identifyEdgeCaseAPIs } from './clustering_utils';
import {
    MigrationComparison,
    MigrationStats,
    matchMigrationPairs,
    compareMigration,
    calculateMigrationStats,
    getTopMigrations,
    getProblematicMigrations,
} from './migration_comparison';

export interface OverallStats {
    totalExtensions: number;
    totalApiCalls: number;
    uniqueAPIs: number;
    avgApisPerExtension: number;
    avgCallsPerExtension: number;
    manifestVersions: {
        mv2: number;
        mv3: number;
    };
    sources: {
        filesystem: number;
        database: number;
        output: number;
    };
    migrationNeeded: number;
    migrationPercentage: number;
}

export interface ClusterStats {
    id: number;
    name: string;
    size: number;
    percentage: number;
    avgApiCalls: number;
    topApis: string[];
    mv2Count: number;
    mv3Count: number;
    complexity: 'simple' | 'moderate' | 'complex';
}

/**
 * Calculate overall statistics from all extensions
 */
export function calculateOverallStats(extensions: ExtensionData[]): OverallStats {
    const allApis = new Set<string>();
    let totalApiCalls = 0;
    const sources = { filesystem: 0, database: 0, output: 0 };
    const manifestVersions = { mv2: 0, mv3: 0 };
    let migrationNeeded = 0;

    for (const ext of extensions) {
        totalApiCalls += ext.totalApiCalls;
        sources[ext.source]++;

        if (ext.manifestVersion === 2) manifestVersions.mv2++;
        else manifestVersions.mv3++;

        Object.keys(ext.fullApiUsage).forEach((api) => {
            if (ext.fullApiUsage[api] > 0) allApis.add(api);
        });

        if (Object.keys(ext.fullApiUsage).some((api) => needsMigration(api))) {
            migrationNeeded++;
        }
    }

    return {
        totalExtensions: extensions.length,
        totalApiCalls,
        uniqueAPIs: allApis.size,
        avgApisPerExtension: extensions.length > 0 ? allApis.size / extensions.length : 0,
        avgCallsPerExtension: extensions.length > 0 ? totalApiCalls / extensions.length : 0,
        manifestVersions,
        sources,
        migrationNeeded,
        migrationPercentage:
            extensions.length > 0 ? (migrationNeeded / extensions.length) * 100 : 0,
    };
}

/**
 * Calculate enhanced cluster statistics
 */
export function calculateClusterStats(
    clusters: ClusterResult[],
    totalExtensions: number
): ClusterStats[] {
    return clusters.map((cluster) => {
        const avgApiCalls =
            cluster.extensions.reduce((sum, ext) => sum + ext.totalApiCalls, 0) /
            cluster.extensions.length;

        const mv2Count = cluster.extensions.filter((e) => e.manifestVersion === 2).length;
        const mv3Count = cluster.extensions.filter((e) => e.manifestVersion === 3).length;

        // Determine complexity based on API diversity and call volume
        let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
        if (cluster.commonAPIs.length > 10 || avgApiCalls > 100) {
            complexity = 'moderate';
        }
        if (cluster.commonAPIs.length > 20 || avgApiCalls > 500) {
            complexity = 'complex';
        }

        return {
            id: cluster.clusterId,
            name: cluster.clusterName,
            size: cluster.extensions.length,
            percentage: (cluster.extensions.length / totalExtensions) * 100,
            avgApiCalls: Math.round(avgApiCalls),
            topApis: cluster.commonAPIs.slice(0, 5),
            mv2Count,
            mv3Count,
            complexity,
        };
    });
}

/**
 * Print overall statistics banner
 */
export function printOverallStats(stats: OverallStats): void {
    console.log(chalk.bold.cyan('\n' + '═'.repeat(80)));
    console.log(chalk.bold.cyan('                    EXTENSION CLUSTERING ANALYSIS'));
    console.log(chalk.bold.cyan('═'.repeat(80) + '\n'));

    console.log(chalk.bold.white('📊 Dataset Overview:\n'));

    // Extensions info
    console.log(chalk.bold('  Total Extensions:'), chalk.green(stats.totalExtensions.toString()));
    console.log(
        chalk.bold('  Total API Calls:'),
        chalk.green(stats.totalApiCalls.toLocaleString())
    );
    console.log(chalk.bold('  Unique APIs Used:'), chalk.green(stats.uniqueAPIs.toString()));
    console.log(
        chalk.bold('  Avg APIs/Extension:'),
        chalk.yellow(stats.avgApisPerExtension.toFixed(1))
    );
    console.log(
        chalk.bold('  Avg Calls/Extension:'),
        chalk.yellow(stats.avgCallsPerExtension.toFixed(0))
    );

    // Source breakdown
    console.log(chalk.bold('\n  📁 Sources:'));
    if (stats.sources.filesystem > 0) {
        const pct = ((stats.sources.filesystem / stats.totalExtensions) * 100).toFixed(1);
        console.log(chalk.gray(`     Filesystem: ${stats.sources.filesystem} (${pct}%)`));
    }
    if (stats.sources.database > 0) {
        const pct = ((stats.sources.database / stats.totalExtensions) * 100).toFixed(1);
        console.log(chalk.gray(`     Database: ${stats.sources.database} (${pct}%)`));
    }
    if (stats.sources.output > 0) {
        const pct = ((stats.sources.output / stats.totalExtensions) * 100).toFixed(1);
        console.log(chalk.gray(`     Output: ${stats.sources.output} (${pct}%)`));
    }

    // Manifest versions
    console.log(chalk.bold('\n  📝 Manifest Versions:'));
    console.log(
        chalk.gray(
            `     MV2: ${stats.manifestVersions.mv2} (${((stats.manifestVersions.mv2 / stats.totalExtensions) * 100).toFixed(1)}%)`
        )
    );
    console.log(
        chalk.gray(
            `     MV3: ${stats.manifestVersions.mv3} (${((stats.manifestVersions.mv3 / stats.totalExtensions) * 100).toFixed(1)}%)`
        )
    );

    // Migration status
    if (stats.migrationNeeded > 0) {
        console.log(chalk.bold('\n  ⚠️  Migration Status:'));
        console.log(
            chalk.red(
                `     ${stats.migrationNeeded} extensions (${stats.migrationPercentage.toFixed(1)}%) `
            ) + chalk.red('need MV2→MV3 migration')
        );
    } else {
        console.log(chalk.bold('\n  ✅ Migration Status:'));
        console.log(chalk.green('     All extensions use MV3-compatible APIs'));
    }

    console.log(chalk.cyan('\n' + '─'.repeat(80) + '\n'));
}

/**
 * Print enhanced cluster information
 */
export function printClusterAnalysis(clusters: ClusterResult[], stats: ClusterStats[]): void {
    console.log(chalk.bold.cyan('📊 Cluster Analysis:\n'));

    // Sort by size descending
    const sortedStats = [...stats].sort((a, b) => b.size - a.size);

    sortedStats.forEach((stat, index) => {
        // Cluster header
        const complexityColor =
            stat.complexity === 'complex'
                ? chalk.red
                : stat.complexity === 'moderate'
                  ? chalk.yellow
                  : chalk.green;

        console.log(
            chalk.bold(`${index + 1}. ${stat.name}`) + chalk.gray(` (Cluster #${stat.id})`)
        );

        // Metrics
        console.log(
            chalk.gray(`   Size: `) +
                chalk.white(`${stat.size} extensions (${stat.percentage.toFixed(1)}%)`)
        );
        console.log(chalk.gray(`   Complexity: `) + complexityColor(stat.complexity));
        console.log(chalk.gray(`   Avg API Calls: `) + chalk.white(stat.avgApiCalls.toString()));

        // Manifest version breakdown
        if (stat.mv2Count > 0 && stat.mv3Count > 0) {
            console.log(
                chalk.gray(`   Versions: `) +
                    chalk.yellow(`${stat.mv2Count} MV2`) +
                    chalk.gray(', ') +
                    chalk.green(`${stat.mv3Count} MV3`)
            );
        } else if (stat.mv2Count > 0) {
            console.log(chalk.gray(`   Versions: `) + chalk.yellow(`${stat.mv2Count} MV2`));
        } else {
            console.log(chalk.gray(`   Versions: `) + chalk.green(`${stat.mv3Count} MV3`));
        }

        // Top APIs
        console.log(chalk.gray(`   Top APIs: `) + chalk.white(stat.topApis.slice(0, 3).join(', ')));

        console.log('');
    });

    console.log(chalk.cyan('─'.repeat(80) + '\n'));
}

/**
 * Print API domain analysis with better formatting
 */
export function printAPIDomainAnalysis(apiDomains: APIDomainStats[], limit: number = 15): void {
    console.log(chalk.bold.cyan('🔌 API Domain Analysis:\n'));

    const displayed = apiDomains.slice(0, limit);

    displayed.forEach((domain, index) => {
        const migrationBadge =
            domain.unmigrated > 0
                ? chalk.red(` ⚠️  ${domain.unmigrated} need migration`)
                : chalk.green(' ✓');

        console.log(chalk.bold(`${index + 1}. ${domain.domain}`) + migrationBadge);

        console.log(
            chalk.gray(`   Extensions: `) +
                chalk.white(domain.totalExtensions.toString()) +
                chalk.gray(` | Calls: `) +
                chalk.white(domain.totalCalls.toLocaleString())
        );

        // Show top 3 APIs in this domain
        const topApis = domain.apis.slice(0, 3).map((api) => {
            const shortName = api.api.replace(domain.domain + '.', '');
            const badge = api.needsMigration ? chalk.red(' [MV2]') : '';
            return `${shortName} (${api.extensionCount})${badge}`;
        });

        console.log(chalk.gray(`   Top: `) + chalk.white(topApis.join(', ')));
        console.log('');
    });

    if (apiDomains.length > limit) {
        console.log(chalk.gray(`   ... and ${apiDomains.length - limit} more domains\n`));
    }

    console.log(chalk.cyan('─'.repeat(80) + '\n'));
}

/**
 * Print migration recommendations
 */
export function printMigrationRecommendations(
    extensions: ExtensionData[],
    _apiDomains: APIDomainStats[]
): void {
    const extensionsNeedingMigration = extensions.filter((ext) =>
        Object.keys(ext.fullApiUsage).some((api) => needsMigration(api))
    );

    if (extensionsNeedingMigration.length === 0) {
        console.log(
            chalk.bold.green('✅ No migration needed - all extensions use MV3-compatible APIs!\n')
        );
        return;
    }

    console.log(chalk.bold.yellow('⚠️  Migration Recommendations:\n'));

    // Count deprecated APIs
    const deprecatedApiCounts = new Map<string, number>();
    for (const ext of extensionsNeedingMigration) {
        for (const api of Object.keys(ext.fullApiUsage)) {
            if (needsMigration(api) && ext.fullApiUsage[api] > 0) {
                deprecatedApiCounts.set(api, (deprecatedApiCounts.get(api) || 0) + 1);
            }
        }
    }

    // Sort by frequency
    const sortedDeprecated = Array.from(deprecatedApiCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

    console.log(chalk.bold('  Most Common Deprecated APIs:\n'));
    sortedDeprecated.forEach(([api, count]) => {
        const percentage = ((count / extensionsNeedingMigration.length) * 100).toFixed(1);
        console.log(
            chalk.red(`   • ${api}`) + chalk.gray(` - used in ${count} extensions (${percentage}%)`)
        );
    });

    console.log(chalk.bold(`\n  Priority Extensions (showing top 10):\n`));

    // Sort by number of deprecated APIs used
    const sortedExtensions = extensionsNeedingMigration
        .map((ext) => ({
            ext,
            deprecatedCount: Object.keys(ext.fullApiUsage).filter(
                (api) => needsMigration(api) && ext.fullApiUsage[api] > 0
            ).length,
        }))
        .sort((a, b) => b.deprecatedCount - a.deprecatedCount)
        .slice(0, 10);

    sortedExtensions.forEach(({ ext, deprecatedCount }) => {
        const deprecatedApis = Object.keys(ext.fullApiUsage)
            .filter((api) => needsMigration(api) && ext.fullApiUsage[api] > 0)
            .slice(0, 3);

        console.log(
            chalk.yellow(`   ${ext.name}`) + chalk.gray(` (${deprecatedCount} deprecated APIs)`)
        );
        console.log(chalk.gray(`      Uses: ${deprecatedApis.join(', ')}`));
    });

    if (extensionsNeedingMigration.length > 10) {
        console.log(
            chalk.gray(`\n   ... and ${extensionsNeedingMigration.length - 10} more extensions`)
        );
    }

    console.log(chalk.cyan('\n' + '─'.repeat(80) + '\n'));
}

/**
 * Print edge case / problematic APIs
 */
export function printEdgeCaseAPIs(extensions: ExtensionData[]): void {
    const edgeCases = identifyEdgeCaseAPIs(extensions);

    if (edgeCases.length === 0) {
        return;
    }

    console.log(chalk.bold.yellow('⚠️  Potential Edge Case APIs:\n'));
    console.log(chalk.gray('  APIs that may require special attention during migration:\n'));

    // Group by severity
    const high = edgeCases.filter((e) => e.severity === 'high');
    const medium = edgeCases.filter((e) => e.severity === 'medium');
    const low = edgeCases.filter((e) => e.severity === 'low');

    if (high.length > 0) {
        console.log(chalk.bold.red('  High Severity:\n'));
        high.forEach((edge) => {
            console.log(chalk.red(`   • ${edge.api}`));
            console.log(chalk.gray(`     ${edge.reason}`));
            console.log(chalk.gray(`     Affects ${edge.extensionCount} extension(s)\n`));
        });
    }

    if (medium.length > 0) {
        console.log(chalk.bold.yellow('  Medium Severity:\n'));
        medium.forEach((edge) => {
            console.log(chalk.yellow(`   • ${edge.api}`));
            console.log(chalk.gray(`     ${edge.reason}`));
            console.log(chalk.gray(`     Affects ${edge.extensionCount} extension(s)\n`));
        });
    }

    if (low.length > 0) {
        console.log(chalk.bold.blue('  Low Severity:\n'));
        low.forEach((edge) => {
            console.log(chalk.blue(`   • ${edge.api}`));
            console.log(chalk.gray(`     ${edge.reason}`));
            console.log(chalk.gray(`     Affects ${edge.extensionCount} extension(s)\n`));
        });
    }

    console.log(chalk.cyan('─'.repeat(80) + '\n'));
}

/**
 * Print migration comparison analysis
 */
export function printMigrationComparison(
    mv2Extensions: ExtensionData[],
    mv3Extensions: ExtensionData[],
    idMappings?: Map<string, string>
): void {
    console.log(chalk.bold.cyan('🔄 Migration Comparison Analysis:\n'));

    // Match pairs using database ID mappings
    const pairs = matchMigrationPairs(mv2Extensions, mv3Extensions, idMappings);

    if (pairs.length === 0) {
        console.log(chalk.yellow('  ⚠️ No matching extension pairs found.'));
        console.log(chalk.gray('  This is expected if:'));
        console.log(chalk.gray('    - Database mappings not loaded (requires --database flag)'));
        console.log(chalk.gray('    - MV2/MV3 extensions are from different datasets'));
        console.log(chalk.gray("    - Output directory extensions haven't been loaded\n"));
        console.log(chalk.gray('  Continuing with other analysis...\n'));
        return;
    }

    // Compare all pairs
    const comparisons = pairs.map((pair) => compareMigration(pair));
    const stats = calculateMigrationStats(comparisons);

    // Print overall stats
    console.log(chalk.bold.white('  Overall Migration Statistics:\n'));
    console.log(chalk.bold(`  Total Pairs Analyzed: `) + chalk.green(stats.totalPairs.toString()));
    console.log(
        chalk.bold(`  Successful Migrations: `) +
            chalk.green(
                `${stats.successfulMigrations} (${((stats.successfulMigrations / stats.totalPairs) * 100).toFixed(1)}%)`
            )
    );
    console.log(
        chalk.bold(`  Failed Migrations: `) +
            chalk.red(
                `${stats.failedMigrations} (${((stats.failedMigrations / stats.totalPairs) * 100).toFixed(1)}%)`
            )
    );
    console.log('');

    // Quality breakdown
    console.log(chalk.bold('  Migration Quality:'));
    console.log(
        chalk.green(
            `    Excellent: ${stats.excellent} (${((stats.excellent / stats.totalPairs) * 100).toFixed(1)}%)`
        )
    );
    console.log(
        chalk.green(
            `    Good: ${stats.good} (${((stats.good / stats.totalPairs) * 100).toFixed(1)}%)`
        )
    );
    console.log(
        chalk.yellow(
            `    Poor: ${stats.poor} (${((stats.poor / stats.totalPairs) * 100).toFixed(1)}%)`
        )
    );
    console.log(
        chalk.red(
            `    Failed: ${stats.failed} (${((stats.failed / stats.totalPairs) * 100).toFixed(1)}%)`
        )
    );
    console.log('');

    // Average metrics
    console.log(chalk.bold('  Average Changes:'));
    console.log(
        chalk.gray(`    API Count: `) +
            (stats.averageApiReduction > 0 ? chalk.green : chalk.red)(
                `${stats.averageApiReduction > 0 ? '-' : '+'}${Math.abs(stats.averageApiReduction).toFixed(1)}%`
            )
    );
    console.log(
        chalk.gray(`    API Calls: `) +
            (stats.averageCallReduction > 0 ? chalk.green : chalk.red)(
                `${stats.averageCallReduction > 0 ? '-' : '+'}${Math.abs(stats.averageCallReduction).toFixed(1)}%`
            )
    );
    console.log('');

    // Most migrated APIs
    if (stats.mostMigratedAPIs.length > 0) {
        console.log(chalk.bold('  Most Common API Migrations:\n'));
        stats.mostMigratedAPIs.slice(0, 10).forEach((migration, index) => {
            console.log(
                chalk.gray(`  ${index + 1}. `) +
                    chalk.yellow(migration.from) +
                    chalk.gray(' → ') +
                    chalk.green(migration.to) +
                    chalk.gray(` (${migration.count} extensions)`)
            );
        });
        console.log('');
    }

    // Unmapped APIs
    if (stats.unmappedAPIs.length > 0) {
        console.log(chalk.bold.red('  ⚠️  Unmapped/Unresolved APIs:\n'));
        console.log(chalk.gray('  These APIs were removed but no MV3 equivalent was detected:\n'));
        stats.unmappedAPIs.slice(0, 10).forEach((unmapped, index) => {
            console.log(
                chalk.gray(`  ${index + 1}. `) +
                    chalk.red(unmapped.api) +
                    chalk.gray(` (${unmapped.count} extensions)`)
            );
        });
        console.log('');
    }

    // Top successful migrations
    const topMigrations = getTopMigrations(comparisons, 5);
    if (topMigrations.length > 0) {
        console.log(chalk.bold.green('  ✅ Best Migration Examples:\n'));
        topMigrations.forEach((comp, index) => {
            console.log(
                chalk.green(`  ${index + 1}. ${comp.name}`) +
                    chalk.gray(` - migrated ${comp.apisMigrated.length} APIs successfully`)
            );
        });
        console.log('');
    }

    // Problematic migrations
    const problematic = getProblematicMigrations(comparisons, 5);
    if (problematic.length > 0) {
        console.log(chalk.bold.red('  ❌ Migrations Needing Attention:\n'));
        problematic.forEach((comp, index) => {
            console.log(
                chalk.red(`  ${index + 1}. ${comp.name}`) +
                    chalk.gray(` - ${comp.deprecatedAPIsRemaining} deprecated APIs remaining`)
            );
        });
        console.log('');
    }

    console.log(chalk.cyan('─'.repeat(80) + '\n'));
}

/**
 * Print actionable insights
 */
export function printInsights(
    stats: OverallStats,
    clusterStats: ClusterStats[],
    apiDomains: APIDomainStats[]
): void {
    console.log(chalk.bold.cyan('💡 Key Insights:\n'));

    const insights: string[] = [];

    // Cluster insights
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

    // API insights
    const mostUsedDomain = apiDomains[0];
    if (mostUsedDomain) {
        insights.push(
            `Most popular API: ${mostUsedDomain.domain} used in ${mostUsedDomain.totalExtensions} extensions`
        );
    }

    // Migration insights
    if (stats.migrationPercentage > 50) {
        insights.push(
            chalk.red(
                `⚠️  ${stats.migrationPercentage.toFixed(0)}% of extensions need migration - high priority!`
            )
        );
    } else if (stats.migrationPercentage > 0) {
        insights.push(`${stats.migrationPercentage.toFixed(0)}% of extensions need migration`);
    }

    // Manifest version insights
    if (stats.manifestVersions.mv2 > stats.manifestVersions.mv3) {
        insights.push(
            `Dataset is primarily MV2 (${((stats.manifestVersions.mv2 / stats.totalExtensions) * 100).toFixed(0)}%) - good for migration testing`
        );
    } else if (stats.manifestVersions.mv3 > 0) {
        insights.push(
            `Dataset includes ${stats.manifestVersions.mv3} MV3 extensions - useful for comparison`
        );
    }

    insights.forEach((insight, i) => {
        console.log(`  ${i + 1}. ${insight}`);
    });

    console.log(chalk.cyan('\n' + '═'.repeat(80) + '\n'));
}
