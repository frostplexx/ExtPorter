/**
 * Advanced filtering engine for extensions
 */

import { ExtensionMetadata, FilterCriteria } from './types';
import chalk from 'chalk';

export class ExtensionFilterEngine {
    /**
     * Apply all filters to a list of extensions
     */
    static filterExtensions(
        extensions: ExtensionMetadata[],
        filters: FilterCriteria
    ): ExtensionMetadata[] {
        console.log(chalk.blue('Applying filters...'));
        const initial = extensions.length;

        let filtered = extensions;

        // Source filters
        if (filters.sources && filters.sources.length > 0) {
            filtered = filtered.filter((ext) => filters.sources!.includes(ext.source));
            console.log(chalk.gray(`  After source filter: ${filtered.length}/${initial}`));
        }

        // Manifest version filters
        if (filters.manifestVersions && filters.manifestVersions.length > 0) {
            filtered = filtered.filter((ext) =>
                filters.manifestVersions!.includes(ext.manifestVersion)
            );
            console.log(
                chalk.gray(`  After manifest version filter: ${filtered.length}/${initial}`)
            );
        }

        // API call count filters
        if (filters.minApiCalls !== undefined) {
            filtered = filtered.filter((ext) => ext.totalApiCalls >= filters.minApiCalls!);
            console.log(
                chalk.gray(
                    `  After min API calls filter (>=${filters.minApiCalls}): ${filtered.length}/${initial}`
                )
            );
        }

        if (filters.maxApiCalls !== undefined) {
            filtered = filtered.filter((ext) => ext.totalApiCalls <= filters.maxApiCalls!);
            console.log(
                chalk.gray(
                    `  After max API calls filter (<=${filters.maxApiCalls}): ${filtered.length}/${initial}`
                )
            );
        }

        // Required APIs - must have ALL
        if (filters.requiredApis && filters.requiredApis.length > 0) {
            filtered = filtered.filter((ext) =>
                filters.requiredApis!.every((api) => ext.apiUsage[api] && ext.apiUsage[api] > 0)
            );
            console.log(
                chalk.gray(
                    `  After required APIs filter (${filters.requiredApis.join(', ')}): ${filtered.length}/${initial}`
                )
            );
        }

        // Any of APIs - must have at least ONE
        if (filters.anyOfApis && filters.anyOfApis.length > 0) {
            filtered = filtered.filter((ext) =>
                filters.anyOfApis!.some((api) => ext.apiUsage[api] && ext.apiUsage[api] > 0)
            );
            console.log(chalk.gray(`  After any-of APIs filter: ${filtered.length}/${initial}`));
        }

        // Exclude APIs - must NOT have any
        if (filters.excludeApis && filters.excludeApis.length > 0) {
            filtered = filtered.filter(
                (ext) =>
                    !filters.excludeApis!.some((api) => ext.apiUsage[api] && ext.apiUsage[api] > 0)
            );
            console.log(chalk.gray(`  After exclude APIs filter: ${filtered.length}/${initial}`));
        }

        // Tag filters
        if (filters.requiredTags && filters.requiredTags.length > 0) {
            filtered = filtered.filter(
                (ext) => ext.tags && filters.requiredTags!.every((tag) => ext.tags!.includes(tag))
            );
            console.log(chalk.gray(`  After required tags filter: ${filtered.length}/${initial}`));
        }

        if (filters.excludeTags && filters.excludeTags.length > 0) {
            filtered = filtered.filter(
                (ext) => !ext.tags || !filters.excludeTags!.some((tag) => ext.tags!.includes(tag))
            );
            console.log(chalk.gray(`  After exclude tags filter: ${filtered.length}/${initial}`));
        }

        // File count filters
        if (filters.minFileCount !== undefined) {
            filtered = filtered.filter((ext) => ext.totalFiles >= filters.minFileCount!);
            console.log(chalk.gray(`  After min file count filter: ${filtered.length}/${initial}`));
        }

        if (filters.maxFileCount !== undefined) {
            filtered = filtered.filter((ext) => ext.totalFiles <= filters.maxFileCount!);
            console.log(chalk.gray(`  After max file count filter: ${filtered.length}/${initial}`));
        }

        // Size filters
        if (filters.minTotalSize !== undefined) {
            filtered = filtered.filter((ext) => ext.totalFileSize >= filters.minTotalSize!);
            console.log(chalk.gray(`  After min size filter: ${filtered.length}/${initial}`));
        }

        if (filters.maxTotalSize !== undefined) {
            filtered = filtered.filter((ext) => ext.totalFileSize <= filters.maxTotalSize!);
            console.log(chalk.gray(`  After max size filter: ${filtered.length}/${initial}`));
        }

        // Complexity filters
        if (filters.migrationComplexity && filters.migrationComplexity.length > 0) {
            filtered = filtered.filter(
                (ext) =>
                    ext.migrationComplexity &&
                    filters.migrationComplexity!.includes(ext.migrationComplexity)
            );
            console.log(chalk.gray(`  After complexity filter: ${filtered.length}/${initial}`));
        }

        // Interestingness score filters
        if (filters.minInterestingnessScore !== undefined) {
            filtered = filtered.filter(
                (ext) =>
                    ext.interestingnessScore !== undefined &&
                    ext.interestingnessScore >= filters.minInterestingnessScore!
            );
            console.log(
                chalk.gray(`  After min interestingness filter: ${filtered.length}/${initial}`)
            );
        }

        if (filters.maxInterestingnessScore !== undefined) {
            filtered = filtered.filter(
                (ext) =>
                    ext.interestingnessScore !== undefined &&
                    ext.interestingnessScore <= filters.maxInterestingnessScore!
            );
            console.log(
                chalk.gray(`  After max interestingness filter: ${filtered.length}/${initial}`)
            );
        }

        // Name/ID filters
        if (filters.nameContains) {
            const regex = new RegExp(filters.nameContains, 'i');
            filtered = filtered.filter((ext) => regex.test(ext.name));
            console.log(chalk.gray(`  After name filter: ${filtered.length}/${initial}`));
        }

        if (filters.idContains) {
            const regex = new RegExp(filters.idContains, 'i');
            filtered = filtered.filter((ext) => regex.test(ext.id));
            console.log(chalk.gray(`  After ID filter: ${filtered.length}/${initial}`));
        }

        const removed = initial - filtered.length;
        if (removed > 0) {
            console.log(
                chalk.green(
                    `✓ Filters applied: ${filtered.length} extensions remaining (${removed} filtered out)`
                )
            );
        } else {
            console.log(chalk.green(`✓ No extensions filtered out`));
        }

        return filtered;
    }

    /**
     * Create a filter from command line arguments
     */
    static parseFilterArgs(args: string[]): FilterCriteria {
        const filters: FilterCriteria = {};

        for (let i = 0; i < args.length; i++) {
            switch (args[i]) {
                case '--source':
                    filters.sources = args[++i].split(',') as any[];
                    break;
                case '--mv':
                case '--manifest-version':
                    filters.manifestVersions = args[++i]
                        .split(',')
                        .map((v) => parseInt(v)) as any[];
                    break;
                case '--min-apis':
                    filters.minApiCalls = parseInt(args[++i]);
                    break;
                case '--max-apis':
                    filters.maxApiCalls = parseInt(args[++i]);
                    break;
                case '--require-api':
                    if (!filters.requiredApis) filters.requiredApis = [];
                    filters.requiredApis.push(args[++i]);
                    break;
                case '--any-api':
                    if (!filters.anyOfApis) filters.anyOfApis = [];
                    filters.anyOfApis.push(args[++i]);
                    break;
                case '--exclude-api':
                    if (!filters.excludeApis) filters.excludeApis = [];
                    filters.excludeApis.push(args[++i]);
                    break;
                case '--require-tag':
                    if (!filters.requiredTags) filters.requiredTags = [];
                    filters.requiredTags.push(args[++i]);
                    break;
                case '--exclude-tag':
                    if (!filters.excludeTags) filters.excludeTags = [];
                    filters.excludeTags.push(args[++i]);
                    break;
                case '--complexity':
                    filters.migrationComplexity = args[++i].split(',') as any[];
                    break;
                case '--min-files':
                    filters.minFileCount = parseInt(args[++i]);
                    break;
                case '--max-files':
                    filters.maxFileCount = parseInt(args[++i]);
                    break;
                case '--name':
                    filters.nameContains = args[++i];
                    break;
                case '--id':
                    filters.idContains = args[++i];
                    break;
            }
        }

        return filters;
    }

    /**
     * Print filter summary
     */
    static printFilterSummary(filters: FilterCriteria): void {
        console.log(chalk.bold.cyan('\n📋 Active Filters:'));

        let hasFilters = false;

        if (filters.sources && filters.sources.length > 0) {
            console.log(`  Sources: ${filters.sources.join(', ')}`);
            hasFilters = true;
        }

        if (filters.manifestVersions && filters.manifestVersions.length > 0) {
            console.log(`  Manifest Versions: ${filters.manifestVersions.join(', ')}`);
            hasFilters = true;
        }

        if (filters.minApiCalls !== undefined || filters.maxApiCalls !== undefined) {
            const min = filters.minApiCalls ?? '∞';
            const max = filters.maxApiCalls ?? '∞';
            console.log(`  API Calls: ${min} - ${max}`);
            hasFilters = true;
        }

        if (filters.requiredApis && filters.requiredApis.length > 0) {
            console.log(`  Required APIs: ${filters.requiredApis.join(', ')}`);
            hasFilters = true;
        }

        if (filters.anyOfApis && filters.anyOfApis.length > 0) {
            console.log(`  Any of APIs: ${filters.anyOfApis.join(', ')}`);
            hasFilters = true;
        }

        if (filters.excludeApis && filters.excludeApis.length > 0) {
            console.log(`  Exclude APIs: ${filters.excludeApis.join(', ')}`);
            hasFilters = true;
        }

        if (filters.migrationComplexity && filters.migrationComplexity.length > 0) {
            console.log(`  Complexity: ${filters.migrationComplexity.join(', ')}`);
            hasFilters = true;
        }

        if (!hasFilters) {
            console.log(`  ${chalk.gray('No filters applied')}`);
        }

        console.log('');
    }
}
