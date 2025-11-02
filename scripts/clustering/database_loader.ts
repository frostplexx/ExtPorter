/**
 * Database integration for loading and querying extensions
 */

import { Database, Collections } from '../../migrator/features/database/db_manager';
import { Extension } from '../../migrator/types/extension';
import { LazyFile } from '../../migrator/types/abstract_file';
import { ExtensionMetadata, FilterCriteria } from './types';
import { extractAPIUsage } from './api_extractor';
import chalk from 'chalk';

export class DatabaseExtensionLoader {
    private db: Database;

    constructor() {
        this.db = Database.shared;
    }

    /**
     * Initialize database connection
     */
    async initialize(): Promise<void> {
        if (!this.db.database) {
            await this.db.init();
        }
    }

    /**
     * Build MongoDB query from filter criteria
     */
    private buildDatabaseQuery(filters?: FilterCriteria): any {
        const query: any = {};

        if (!filters) return query;

        // Manifest version filter
        if (filters.manifestVersions && filters.manifestVersions.length > 0) {
            query['manifest.manifest_version'] = { $in: filters.manifestVersions };
        }

        // Tag filters
        if (filters.requiredTags && filters.requiredTags.length > 0) {
            query.tags = { $all: filters.requiredTags };
        }

        if (filters.excludeTags && filters.excludeTags.length > 0) {
            query.tags = { ...query.tags, $nin: filters.excludeTags };
        }

        // Interestingness score filters
        if (
            filters.minInterestingnessScore !== undefined ||
            filters.maxInterestingnessScore !== undefined
        ) {
            query.interestingness_score = {};

            if (filters.minInterestingnessScore !== undefined) {
                query.interestingness_score.$gte = filters.minInterestingnessScore;
            }

            if (filters.maxInterestingnessScore !== undefined) {
                query.interestingness_score.$lte = filters.maxInterestingnessScore;
            }
        }

        // Name/ID filters
        if (filters.nameContains) {
            query.name = { $regex: filters.nameContains, $options: 'i' };
        }

        if (filters.idContains) {
            query.id = { $regex: filters.idContains, $options: 'i' };
        }

        return query;
    }

    /**
     * Load extensions from database with optional filters
     */
    async loadExtensions(filters?: FilterCriteria): Promise<ExtensionMetadata[]> {
        console.log(chalk.blue('Loading extensions from database...'));

        await this.initialize();

        const query = this.buildDatabaseQuery(filters);
        const collection = this.db.database!.collection(Collections.EXTENSIONS);

        // Apply limit if needed for performance
        const cursor = collection.find(query).limit(1000);
        const dbExtensions = await cursor.toArray();

        console.log(chalk.gray(`  Found ${dbExtensions.length} extensions in database`));

        const extensionMetadata: ExtensionMetadata[] = [];
        let processed = 0;
        let skipped = 0;

        for (const ext of dbExtensions) {
            try {
                // Reconstruct Extension object
                const extension: Extension = {
                    id: ext.id,
                    name: ext.name,
                    manifest_v2_path: ext.manifest_v2_path || '',
                    manifest: ext.manifest,
                    files: [],
                    tags: ext.tags,
                    interestingness_score: ext.interestingness_score,
                };

                // If files are stored in database, use them
                if (ext.files && Array.isArray(ext.files) && ext.files.length > 0) {
                    extension.files = ext.files.map((f: any) => {
                        const mockFile = Object.create(LazyFile.prototype);
                        mockFile.path = f.path;
                        mockFile.filetype = f.filetype;
                        mockFile.getContent = () => f.content || '';
                        mockFile.getSize = () =>
                            f.content ? Buffer.byteLength(f.content, 'utf8') : 0;
                        mockFile.close = () => {};
                        return mockFile;
                    });

                    // Extract API usage
                    const apiUsage = extractAPIUsage(extension);
                    const totalApiCalls = Object.values(apiUsage).reduce(
                        (sum: number, count: number) => sum + count,
                        0
                    );
                    const uniqueApisUsed = Object.values(apiUsage).filter(
                        (count: number) => count > 0
                    ).length;

                    // Calculate file statistics
                    const jsFileCount = extension.files.length;
                    const totalFileSize = extension.files.reduce(
                        (sum: number, f) => sum + f.getSize(),
                        0
                    );

                    // Determine migration complexity
                    const migrationComplexity = this.calculateMigrationComplexity(
                        apiUsage,
                        ext.interestingness_score
                    );

                    const metadata: ExtensionMetadata = {
                        id: extension.id,
                        name: extension.name,
                        source: 'database',
                        manifestVersion: extension.manifest?.manifest_version || 2,
                        apiUsage,
                        totalApiCalls,
                        uniqueApisUsed,
                        totalFiles: extension.files.length,
                        jsFileCount,
                        totalFileSize,
                        tags: extension.tags,
                        interestingnessScore: ext.interestingness_score,
                        migrationComplexity,
                    };

                    // Apply post-load filters
                    if (this.passesFilters(metadata, filters)) {
                        extensionMetadata.push(metadata);
                        processed++;
                    } else {
                        skipped++;
                    }
                } else {
                    skipped++;
                }
            } catch (error) {
                console.log(
                    chalk.yellow(`  Warning: Failed to process extension ${ext.id}: ${error}`)
                );
                skipped++;
            }
        }

        console.log(
            chalk.green(
                `✓ Loaded ${processed} extensions from database (${skipped} skipped due to filters/errors)`
            )
        );
        return extensionMetadata;
    }

    /**
     * Check if extension passes all filters
     */
    private passesFilters(metadata: ExtensionMetadata, filters?: FilterCriteria): boolean {
        if (!filters) return true;

        // API call filters
        if (filters.minApiCalls !== undefined && metadata.totalApiCalls < filters.minApiCalls) {
            return false;
        }

        if (filters.maxApiCalls !== undefined && metadata.totalApiCalls > filters.maxApiCalls) {
            return false;
        }

        // Required APIs - must have ALL
        if (filters.requiredApis && filters.requiredApis.length > 0) {
            const hasAllRequired = filters.requiredApis.every(
                (api) => metadata.apiUsage[api] && metadata.apiUsage[api] > 0
            );
            if (!hasAllRequired) return false;
        }

        // Any of APIs - must have at least ONE
        if (filters.anyOfApis && filters.anyOfApis.length > 0) {
            const hasAny = filters.anyOfApis.some(
                (api) => metadata.apiUsage[api] && metadata.apiUsage[api] > 0
            );
            if (!hasAny) return false;
        }

        // Exclude APIs - must NOT have any
        if (filters.excludeApis && filters.excludeApis.length > 0) {
            const hasExcluded = filters.excludeApis.some(
                (api) => metadata.apiUsage[api] && metadata.apiUsage[api] > 0
            );
            if (hasExcluded) return false;
        }

        // File count filters
        if (filters.minFileCount !== undefined && metadata.totalFiles < filters.minFileCount) {
            return false;
        }

        if (filters.maxFileCount !== undefined && metadata.totalFiles > filters.maxFileCount) {
            return false;
        }

        // Size filters
        if (filters.minTotalSize !== undefined && metadata.totalFileSize < filters.minTotalSize) {
            return false;
        }

        if (filters.maxTotalSize !== undefined && metadata.totalFileSize > filters.maxTotalSize) {
            return false;
        }

        // Complexity filter
        if (filters.migrationComplexity && filters.migrationComplexity.length > 0) {
            if (!filters.migrationComplexity.includes(metadata.migrationComplexity!)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Calculate migration complexity based on API usage
     */
    private calculateMigrationComplexity(
        apiUsage: { [api: string]: number },
        interestingnessScore?: number
    ): 'simple' | 'moderate' | 'complex' | 'very_complex' {
        const complexApis = [
            'chrome.webRequest',
            'chrome.declarativeNetRequest',
            'chrome.debugger',
            'chrome.proxy',
        ];

        const hasComplexApis = complexApis.some((api) => apiUsage[api] && apiUsage[api] > 0);
        const totalApiCalls = Object.values(apiUsage).reduce((sum, count) => sum + count, 0);
        const uniqueApis = Object.values(apiUsage).filter((count) => count > 0).length;

        // Calculate complexity score
        let complexityScore = 0;

        if (hasComplexApis) complexityScore += 3;
        if (totalApiCalls > 100) complexityScore += 2;
        if (totalApiCalls > 500) complexityScore += 2;
        if (uniqueApis > 10) complexityScore += 1;
        if (uniqueApis > 20) complexityScore += 2;
        if (interestingnessScore && interestingnessScore > 50) complexityScore += 1;
        if (interestingnessScore && interestingnessScore > 100) complexityScore += 2;

        if (complexityScore >= 7) return 'very_complex';
        if (complexityScore >= 4) return 'complex';
        if (complexityScore >= 2) return 'moderate';
        return 'simple';
    }

    /**
     * Get extension count by various criteria
     */
    async getStatistics(): Promise<{
        total: number;
        byManifestVersion: { mv2: number; mv3: number };
        byComplexity: Record<string, number>;
        withFiles: number;
        withoutFiles: number;
    }> {
        await this.initialize();

        const collection = this.db.database!.collection(Collections.EXTENSIONS);

        const [total, mv2Count, mv3Count, withFiles] = await Promise.all([
            collection.countDocuments(),
            collection.countDocuments({ 'manifest.manifest_version': 2 }),
            collection.countDocuments({ 'manifest.manifest_version': 3 }),
            collection.countDocuments({ files: { $exists: true, $ne: [] } }),
        ]);

        return {
            total,
            byManifestVersion: {
                mv2: mv2Count,
                mv3: mv3Count,
            },
            byComplexity: {}, // Would need to calculate from all extensions
            withFiles,
            withoutFiles: total - withFiles,
        };
    }

    /**
     * Close database connection
     */
    async close(): Promise<void> {
        await this.db.close();
    }
}
