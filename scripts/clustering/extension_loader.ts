/**
 * Shared extension loading utilities
 */

import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { find_extensions } from '../../migrator/utils/find_extensions';
import { Extension } from '../../migrator/types/extension';
import { Database, Collections } from '../../migrator/features/database/db_manager';
import { LazyFile } from '../../migrator/types/abstract_file';
import { ExtensionData, APIDomainStats } from './types';
import { extractAllAPIUsage, needsMigration } from './clustering_utils';

/**
 * Load extensions from filesystem
 */
export async function loadExtensionsFromFilesystem(inputPath: string): Promise<ExtensionData[]> {
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

/**
 * Load MV2→MV3 ID mappings from database
 */
export async function loadIDMappings(): Promise<Map<string, string>> {
    const mappings = new Map<string, string>();

    try {
        console.log(chalk.blue('Loading MV2→MV3 ID mappings from database...'));

        const db = Database.shared;

        if (!db.database) {
            console.log(chalk.gray('  Initializing database connection...'));
            await db.init();
        }

        const collection = db.database!.collection(Collections.EXTENSIONS);

        console.log(chalk.gray('  Querying for extensions with mv3_extension_id...'));
        const extensions = await collection
            .find({
                mv3_extension_id: { $exists: true, $ne: null },
            })
            .toArray();

        console.log(chalk.gray(`  Found ${extensions.length} extensions with MV3 mappings`));

        for (const ext of extensions) {
            if (ext.id && ext.mv3_extension_id) {
                mappings.set(ext.id, ext.mv3_extension_id);
                // Log first few for debugging
                if (mappings.size <= 3) {
                    console.log(chalk.gray(`    ${ext.id} → ${ext.mv3_extension_id}`));
                }
            }
        }

        console.log(chalk.green(`✓ Loaded ${mappings.size} MV2→MV3 ID mappings from database\n`));
    } catch (error) {
        console.log(chalk.red(`✗ Could not load ID mappings: ${error}\n`));
    }

    return mappings;
}

/**
 * Load extensions from database
 */
export async function loadExtensionsFromDatabase(): Promise<ExtensionData[]> {
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

/**
 * Load extensions from output directory
 * For migration comparison, use loadExtensionsFromOutputWithMapping() instead
 */
export async function loadExtensionsFromOutput(outputPath: string): Promise<ExtensionData[]> {
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

/**
 * Load MV3 extensions from output directory using database mappings for correct IDs
 * This resolves the issue where filesystem path generates different IDs than database
 */
export async function loadExtensionsFromOutputWithMapping(
    outputPath: string
): Promise<ExtensionData[]> {
    console.log(chalk.blue(`Loading MV3 extensions with database ID mapping...`));

    try {
        const db = Database.shared;

        if (!db.database) {
            console.log(chalk.gray('  Initializing database connection...'));
            await db.init();
        }

        const collection = db.database!.collection(Collections.EXTENSIONS);

        // Get all extensions with MV3 paths
        const dbExtensions = await collection
            .find({
                manifest_v3_path: { $exists: true, $ne: null },
                mv3_extension_id: { $exists: true, $ne: null },
            })
            .toArray();

        console.log(chalk.gray(`  Found ${dbExtensions.length} extensions with MV3 output`));

        const extensionData: ExtensionData[] = [];

        for (const dbExt of dbExtensions) {
            try {
                // Extract directory from manifest_v3_path
                const mv3ManifestPath = dbExt.manifest_v3_path;
                const mv3Dir = path.dirname(path.resolve(mv3ManifestPath));

                // Check if this MV3 directory exists
                if (!fs.existsSync(mv3Dir)) {
                    continue;
                }

                // Load the extension from filesystem
                const extensions = find_extensions(mv3Dir, true);
                if (extensions.length === 0) {
                    continue;
                }

                const ext = extensions[0];

                // Extract APIs
                const { baseApiUsage, fullApiUsage } = extractAllAPIUsage(ext);
                const totalApiCalls = Object.values(fullApiUsage).reduce(
                    (sum, count) => sum + count,
                    0
                );

                // Use the MV3 ID from database, not the filesystem-generated one!
                extensionData.push({
                    id: dbExt.mv3_extension_id, // ← Use database ID!
                    name: ext.name,
                    source: 'output',
                    manifestVersion: ext.manifest?.manifest_version || 3,
                    baseApiUsage,
                    fullApiUsage,
                    totalApiCalls,
                });

                ext.files.forEach((f) => f.close());
            } catch (error) {
                console.log(chalk.gray(`  Skipping extension: ${error}`));
            }
        }

        console.log(
            chalk.green(`✓ Loaded ${extensionData.length} MV3 extensions with correct IDs\n`)
        );
        return extensionData;
    } catch (error) {
        console.log(chalk.red(`✗ Could not load MV3 extensions: ${error}\n`));
        return [];
    }
}

/**
 * Group APIs by domain and calculate statistics
 */
export function groupAPIsByDomain(allExtensions: ExtensionData[]): APIDomainStats[] {
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
