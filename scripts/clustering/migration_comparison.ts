/**
 * Migration comparison and analysis
 * Compares MV2 (input) and MV3 (output) extensions to track migration success
 */

import { ExtensionData } from './types';
import { needsMigration, MV2_TO_MV3_MAP } from './clustering_utils';

export interface MigrationPair {
    id: string;
    name: string;
    mv2: ExtensionData;
    mv3: ExtensionData;
}

export interface MigrationComparison {
    id: string;
    name: string;

    // API changes
    apisRemoved: string[];
    apisAdded: string[];
    apisRetained: string[];
    apisMigrated: Array<{ from: string; to: string }>;

    // Metrics
    mv2ApiCount: number;
    mv3ApiCount: number;
    mv2TotalCalls: number;
    mv3TotalCalls: number;

    // Migration success
    deprecatedAPIsResolved: number;
    deprecatedAPIsRemaining: number;
    migrationSuccess: boolean;
    migrationQuality: 'excellent' | 'good' | 'poor' | 'failed';
}

export interface MigrationStats {
    totalPairs: number;
    successfulMigrations: number;
    failedMigrations: number;
    averageApiReduction: number;
    averageCallReduction: number;

    // API migration tracking
    mostMigratedAPIs: Array<{ from: string; to: string; count: number }>;
    unmappedAPIs: Array<{ api: string; count: number }>;

    // Quality breakdown
    excellent: number;
    good: number;
    poor: number;
    failed: number;
}

/**
 * Match MV2 extensions with their MV3 counterparts using database ID mappings
 *
 * @param mv2Extensions - MV2 extensions (from input/database)
 * @param mv3Extensions - MV3 extensions (from output)
 * @param idMappings - Map of MV2 ID → MV3 ID from database
 */
export function matchMigrationPairs(
    mv2Extensions: ExtensionData[],
    mv3Extensions: ExtensionData[],
    idMappings?: Map<string, string>
): MigrationPair[] {
    const pairs: MigrationPair[] = [];
    const mv3Map = new Map(mv3Extensions.map((ext) => [ext.id, ext]));

    console.log(
        `\n[DEBUG] Matching ${mv2Extensions.length} MV2 with ${mv3Extensions.length} MV3 extensions`
    );
    console.log(`[DEBUG] ID mappings available: ${idMappings ? idMappings.size : 0}`);

    if (idMappings && idMappings.size > 0) {
        console.log('[DEBUG] Sample mappings:');
        let count = 0;
        for (const [mv2Id, mv3Id] of idMappings.entries()) {
            console.log(`  ${mv2Id} → ${mv3Id}`);
            count++;
            if (count >= 3) break;
        }
    }

    console.log(
        '[DEBUG] Sample MV2 IDs:',
        mv2Extensions.slice(0, 3).map((e) => e.id)
    );
    console.log(
        '[DEBUG] Sample MV3 IDs:',
        mv3Extensions.slice(0, 3).map((e) => e.id)
    );

    for (const mv2 of mv2Extensions) {
        let mv3: ExtensionData | undefined;

        // First try using database mapping (MV2 ID → MV3 ID)
        if (idMappings) {
            const mv3Id = idMappings.get(mv2.id);
            if (mv3Id) {
                mv3 = mv3Map.get(mv3Id);
                if (mv3) {
                    console.log(`[DEBUG] ✓ Matched ${mv2.id} → ${mv3Id}`);
                } else {
                    console.log(
                        `[DEBUG] ✗ Mapping found ${mv2.id} → ${mv3Id}, but MV3 extension not loaded`
                    );
                }
            }
        }

        // Fallback: try direct ID match (in case IDs are the same)
        if (!mv3) {
            mv3 = mv3Map.get(mv2.id);
            if (mv3) {
                console.log(`[DEBUG] ✓ Direct match ${mv2.id}`);
            }
        }

        if (mv3) {
            pairs.push({
                id: mv2.id,
                name: mv2.name,
                mv2,
                mv3,
            });
        }
    }

    console.log(`[DEBUG] Total pairs matched: ${pairs.length}\n`);

    return pairs;
}

/**
 * Compare a single MV2/MV3 pair to analyze migration quality
 */
export function compareMigration(pair: MigrationPair): MigrationComparison {
    const { mv2, mv3 } = pair;

    // Get all APIs used
    const mv2APIs = new Set(
        Object.keys(mv2.fullApiUsage).filter((api) => mv2.fullApiUsage[api] > 0)
    );
    const mv3APIs = new Set(
        Object.keys(mv3.fullApiUsage).filter((api) => mv3.fullApiUsage[api] > 0)
    );

    // Calculate changes
    const apisRemoved = Array.from(mv2APIs).filter((api) => !mv3APIs.has(api));
    const apisAdded = Array.from(mv3APIs).filter((api) => !mv2APIs.has(api));
    const apisRetained = Array.from(mv2APIs).filter((api) => mv3APIs.has(api));

    // Track migrated APIs (MV2 → MV3 mappings)
    const apisMigrated: Array<{ from: string; to: string }> = [];
    for (const mv2Api of apisRemoved) {
        if (needsMigration(mv2Api)) {
            // Check if corresponding MV3 API exists
            const migration = findMigrationTarget(mv2Api, mv3APIs);
            if (migration) {
                apisMigrated.push({ from: mv2Api, to: migration });
            }
        }
    }

    // Count deprecated APIs
    const deprecatedInMV2 = Array.from(mv2APIs).filter((api) => needsMigration(api)).length;
    const deprecatedInMV3 = Array.from(mv3APIs).filter((api) => needsMigration(api)).length;
    const deprecatedAPIsResolved = deprecatedInMV2 - deprecatedInMV3;

    // Determine migration success
    const migrationSuccess = deprecatedInMV3 === 0;

    // Calculate migration quality
    let migrationQuality: 'excellent' | 'good' | 'poor' | 'failed';
    if (deprecatedInMV3 === 0 && deprecatedInMV2 > 0) {
        migrationQuality = 'excellent';
    } else if (deprecatedAPIsResolved >= deprecatedInMV2 * 0.8) {
        migrationQuality = 'good';
    } else if (deprecatedAPIsResolved > 0) {
        migrationQuality = 'poor';
    } else {
        migrationQuality = 'failed';
    }

    return {
        id: pair.id,
        name: pair.name,
        apisRemoved,
        apisAdded,
        apisRetained,
        apisMigrated,
        mv2ApiCount: mv2APIs.size,
        mv3ApiCount: mv3APIs.size,
        mv2TotalCalls: mv2.totalApiCalls,
        mv3TotalCalls: mv3.totalApiCalls,
        deprecatedAPIsResolved,
        deprecatedAPIsRemaining: deprecatedInMV3,
        migrationSuccess,
        migrationQuality,
    };
}

/**
 * Find the MV3 target API for a deprecated MV2 API
 */
function findMigrationTarget(mv2Api: string, mv3APIs: Set<string>): string | null {
    // Check exact mapping
    const exactMapping = MV2_TO_MV3_MAP[mv2Api];
    if (exactMapping && mv3APIs.has(exactMapping.mv3API)) {
        return exactMapping.mv3API;
    }

    // Check domain-level mapping (e.g., chrome.browserAction.* → chrome.action.*)
    for (const [mv2Pattern, mapping] of Object.entries(MV2_TO_MV3_MAP)) {
        if (mv2Api.startsWith(mv2Pattern + '.')) {
            // Replace the MV2 prefix with MV3 prefix
            const suffix = mv2Api.substring(mv2Pattern.length);
            const mv3Candidate = mapping.mv3API + suffix;
            if (mv3APIs.has(mv3Candidate)) {
                return mv3Candidate;
            }
            // Check if the base API exists
            if (mv3APIs.has(mapping.mv3API)) {
                return mapping.mv3API;
            }
        }
    }

    return null;
}

/**
 * Calculate overall migration statistics
 */
export function calculateMigrationStats(comparisons: MigrationComparison[]): MigrationStats {
    const totalPairs = comparisons.length;
    const successfulMigrations = comparisons.filter((c) => c.migrationSuccess).length;
    const failedMigrations = totalPairs - successfulMigrations;

    // Calculate averages
    let totalApiReduction = 0;
    let totalCallReduction = 0;
    for (const comp of comparisons) {
        const apiReduction = ((comp.mv2ApiCount - comp.mv3ApiCount) / comp.mv2ApiCount) * 100;
        const callReduction =
            ((comp.mv2TotalCalls - comp.mv3TotalCalls) / comp.mv2TotalCalls) * 100;
        totalApiReduction += apiReduction;
        totalCallReduction += callReduction;
    }

    const averageApiReduction = totalPairs > 0 ? totalApiReduction / totalPairs : 0;
    const averageCallReduction = totalPairs > 0 ? totalCallReduction / totalPairs : 0;

    // Track API migrations
    const migrationCounts = new Map<string, { from: string; to: string; count: number }>();
    for (const comp of comparisons) {
        for (const migration of comp.apisMigrated) {
            const key = `${migration.from}→${migration.to}`;
            const existing = migrationCounts.get(key);
            if (existing) {
                existing.count++;
            } else {
                migrationCounts.set(key, { ...migration, count: 1 });
            }
        }
    }

    const mostMigratedAPIs = Array.from(migrationCounts.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    // Find unmapped APIs (removed but not migrated)
    const unmappedCounts = new Map<string, number>();
    for (const comp of comparisons) {
        const migratedFromAPIs = new Set(comp.apisMigrated.map((m) => m.from));
        for (const removed of comp.apisRemoved) {
            if (needsMigration(removed) && !migratedFromAPIs.has(removed)) {
                unmappedCounts.set(removed, (unmappedCounts.get(removed) || 0) + 1);
            }
        }
    }

    const unmappedAPIs = Array.from(unmappedCounts.entries())
        .map(([api, count]) => ({ api, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    // Quality breakdown
    const excellent = comparisons.filter((c) => c.migrationQuality === 'excellent').length;
    const good = comparisons.filter((c) => c.migrationQuality === 'good').length;
    const poor = comparisons.filter((c) => c.migrationQuality === 'poor').length;
    const failed = comparisons.filter((c) => c.migrationQuality === 'failed').length;

    return {
        totalPairs,
        successfulMigrations,
        failedMigrations,
        averageApiReduction,
        averageCallReduction,
        mostMigratedAPIs,
        unmappedAPIs,
        excellent,
        good,
        poor,
        failed,
    };
}

/**
 * Get top successful migrations (best examples)
 */
export function getTopMigrations(
    comparisons: MigrationComparison[],
    limit: number = 10
): MigrationComparison[] {
    return comparisons
        .filter((c) => c.migrationSuccess)
        .sort((a, b) => {
            // Sort by number of APIs migrated
            const aMigrated = a.apisMigrated.length;
            const bMigrated = b.apisMigrated.length;
            return bMigrated - aMigrated;
        })
        .slice(0, limit);
}

/**
 * Get problematic migrations (need attention)
 */
export function getProblematicMigrations(
    comparisons: MigrationComparison[],
    limit: number = 10
): MigrationComparison[] {
    return comparisons
        .filter((c) => !c.migrationSuccess)
        .sort((a, b) => {
            // Sort by number of remaining deprecated APIs
            return b.deprecatedAPIsRemaining - a.deprecatedAPIsRemaining;
        })
        .slice(0, limit);
}
