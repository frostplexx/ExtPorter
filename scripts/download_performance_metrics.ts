#!/usr/bin/env ts-node

import { MongoClient, Db } from 'mongodb';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
dotenv.config();

/**
 * Script to download and analyze performance metrics from ExtPorter's MongoDB database.
 *
 * Metrics collected:
 * - Migration timing statistics
 * - LLM fix attempt durations and success rates
 * - Fakeium validation performance
 * - Memory usage from logs
 * - Extension complexity (interestingness scores)
 * - Per-extension timing breakdown
 *
 * Usage:
 *   ts-node scripts/download_performance_metrics.ts [--json] [--output=<file>] [--detailed]
 */

interface MigrationMetrics {
    totalExtensions: number;
    migratedExtensions: number;
    failedExtensions: number;
    migrationSuccessRate: number;
}

interface LLMMetrics {
    totalAttempts: number;
    successfulAttempts: number;
    failedAttempts: number;
    successRate: number;
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    avgIterations: number;
    totalFilesModified: number;
}

interface ValidationMetrics {
    totalValidated: number;
    equivalentCount: number;
    nonEquivalentCount: number;
    avgSimilarityScore: number;
    avgValidationDurationMs: number;
    avgMv2ApiCalls: number;
    avgMv3ApiCalls: number;
}

interface MemoryMetrics {
    samples: number;
    avgHeapUsedMB: number;
    maxHeapUsedMB: number;
    avgRssMB: number;
    maxRssMB: number;
    gcTriggerCount: number;
}

interface InterestingnessMetrics {
    avgScore: number;
    minScore: number;
    maxScore: number;
    medianScore: number;
    scoreDistribution: { range: string; count: number }[];
    avgBreakdown: {
        webRequest: number;
        html_lines: number;
        storage_local: number;
        background_page: number;
        content_scripts: number;
        dangerous_permissions: number;
        host_permissions: number;
        crypto_patterns: number;
        network_requests: number;
        extension_size: number;
        api_renames: number;
        manifest_changes: number;
        file_modifications: number;
        webRequest_to_dnr_migrations: number;
    };
}

interface LogTimingMetrics {
    migrationStartTime: number | null;
    migrationEndTime: number | null;
    totalMigrationDurationMs: number | null;
    avgTimePerExtensionMs: number | null;
    extensionProcessingTimes: { id: string; name: string; durationMs: number }[];
}

interface ReportMetrics {
    totalReports: number;
    testedCount: number;
    workingCount: number;
    hasErrorsCount: number;
    slowerCount: number;
    avgVerificationDurationSecs: number;
}

interface PerformanceReport {
    generatedAt: string;
    migration: MigrationMetrics;
    llmFixes: LLMMetrics;
    validation: ValidationMetrics;
    memory: MemoryMetrics;
    interestingness: InterestingnessMetrics;
    timing: LogTimingMetrics;
    reports: ReportMetrics;
}

async function connectToDatabase(): Promise<{ client: MongoClient; db: Db }> {
    const uri = process.env.MONGODB_URI;
    const dbName = process.env.DB_NAME;

    if (!uri) {
        throw new Error('MONGODB_URI not found in environment. Set it in .env file.');
    }
    if (!dbName) {
        throw new Error('DB_NAME not found in environment. Set it in .env file.');
    }

    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);

    console.log(`Connected to MongoDB database: ${dbName}`);
    return { client, db };
}

async function getMigrationMetrics(db: Db): Promise<MigrationMetrics> {
    const extensions = db.collection('extensions');

    const total = await extensions.countDocuments();
    const migrated = await extensions.countDocuments({ manifest_v3_path: { $exists: true, $ne: null } });
    const withTags = await extensions.countDocuments({ tags: { $exists: true, $ne: [] } });

    // Extensions that have MV3 path are considered successfully migrated
    const failed = total - migrated;

    return {
        totalExtensions: total,
        migratedExtensions: migrated,
        failedExtensions: failed,
        migrationSuccessRate: total > 0 ? (migrated / total) * 100 : 0,
    };
}

async function getLLMMetrics(db: Db): Promise<LLMMetrics> {
    const llmAttempts = db.collection('llm_fix_attempts');

    const total = await llmAttempts.countDocuments();
    if (total === 0) {
        return {
            totalAttempts: 0,
            successfulAttempts: 0,
            failedAttempts: 0,
            successRate: 0,
            avgDurationMs: 0,
            minDurationMs: 0,
            maxDurationMs: 0,
            avgIterations: 0,
            totalFilesModified: 0,
        };
    }

    const successful = await llmAttempts.countDocuments({ success: true });

    const durationStats = await llmAttempts
        .aggregate([
            {
                $group: {
                    _id: null,
                    avgDuration: { $avg: '$duration_ms' },
                    minDuration: { $min: '$duration_ms' },
                    maxDuration: { $max: '$duration_ms' },
                    avgIterations: { $avg: '$iterations' },
                    totalFiles: { $sum: { $size: { $ifNull: ['$files_modified', []] } } },
                },
            },
        ])
        .toArray();

    const stats = durationStats[0] || {};

    return {
        totalAttempts: total,
        successfulAttempts: successful,
        failedAttempts: total - successful,
        successRate: (successful / total) * 100,
        avgDurationMs: Math.round(stats.avgDuration || 0),
        minDurationMs: Math.round(stats.minDuration || 0),
        maxDurationMs: Math.round(stats.maxDuration || 0),
        avgIterations: Math.round((stats.avgIterations || 0) * 10) / 10,
        totalFilesModified: stats.totalFiles || 0,
    };
}

async function getValidationMetrics(db: Db): Promise<ValidationMetrics> {
    const extensions = db.collection('extensions');

    const validated = await extensions.countDocuments({
        'fakeium_validation.enabled': true,
    });

    if (validated === 0) {
        return {
            totalValidated: 0,
            equivalentCount: 0,
            nonEquivalentCount: 0,
            avgSimilarityScore: 0,
            avgValidationDurationMs: 0,
            avgMv2ApiCalls: 0,
            avgMv3ApiCalls: 0,
        };
    }

    const equivalent = await extensions.countDocuments({
        'fakeium_validation.is_equivalent': true,
    });

    const validationStats = await extensions
        .aggregate([
            { $match: { 'fakeium_validation.enabled': true } },
            {
                $group: {
                    _id: null,
                    avgSimilarity: { $avg: '$fakeium_validation.similarity_score' },
                    avgDuration: { $avg: '$fakeium_validation.duration_ms' },
                    avgMv2Calls: { $avg: '$fakeium_validation.mv2_api_calls' },
                    avgMv3Calls: { $avg: '$fakeium_validation.mv3_api_calls' },
                },
            },
        ])
        .toArray();

    const stats = validationStats[0] || {};

    return {
        totalValidated: validated,
        equivalentCount: equivalent,
        nonEquivalentCount: validated - equivalent,
        avgSimilarityScore: Math.round((stats.avgSimilarity || 0) * 1000) / 1000,
        avgValidationDurationMs: Math.round(stats.avgDuration || 0),
        avgMv2ApiCalls: Math.round((stats.avgMv2Calls || 0) * 10) / 10,
        avgMv3ApiCalls: Math.round((stats.avgMv3Calls || 0) * 10) / 10,
    };
}

async function getMemoryMetrics(db: Db): Promise<MemoryMetrics> {
    const logs = db.collection('logs');

    // Look for memory-related log entries
    const memoryLogs = await logs
        .find({
            $or: [
                { message: { $regex: /memory/i } },
                { 'meta.heapUsedMB': { $exists: true } },
                { 'meta.memory': { $exists: true } },
            ],
        })
        .toArray();

    let heapSamples: number[] = [];
    let rssSamples: number[] = [];
    let gcCount = 0;

    for (const log of memoryLogs) {
        // Check for GC triggers
        if (log.message?.toLowerCase().includes('garbage collection') ||
            log.message?.toLowerCase().includes('gc triggered')) {
            gcCount++;
        }

        // Extract memory values from meta
        if (log.meta?.heapUsedMB) {
            heapSamples.push(log.meta.heapUsedMB);
        }
        if (log.meta?.rssMB) {
            rssSamples.push(log.meta.rssMB);
        }
        if (log.meta?.memory?.heapUsedMB) {
            heapSamples.push(log.meta.memory.heapUsedMB);
        }
        if (log.meta?.memory?.rssMB) {
            rssSamples.push(log.meta.memory.rssMB);
        }
    }

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const max = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : 0);

    return {
        samples: heapSamples.length,
        avgHeapUsedMB: Math.round(avg(heapSamples) * 10) / 10,
        maxHeapUsedMB: Math.round(max(heapSamples) * 10) / 10,
        avgRssMB: Math.round(avg(rssSamples) * 10) / 10,
        maxRssMB: Math.round(max(rssSamples) * 10) / 10,
        gcTriggerCount: gcCount,
    };
}

async function getInterestingnessMetrics(db: Db): Promise<InterestingnessMetrics> {
    const extensions = db.collection('extensions');

    const withScores = await extensions
        .find({ interestingness_score: { $exists: true, $ne: null } })
        .project({ interestingness_score: 1, interestingness_breakdown: 1 })
        .toArray();

    if (withScores.length === 0) {
        return {
            avgScore: 0,
            minScore: 0,
            maxScore: 0,
            medianScore: 0,
            scoreDistribution: [],
            avgBreakdown: {
                webRequest: 0,
                html_lines: 0,
                storage_local: 0,
                background_page: 0,
                content_scripts: 0,
                dangerous_permissions: 0,
                host_permissions: 0,
                crypto_patterns: 0,
                network_requests: 0,
                extension_size: 0,
                api_renames: 0,
                manifest_changes: 0,
                file_modifications: 0,
                webRequest_to_dnr_migrations: 0,
            },
        };
    }

    const scores = withScores.map((e) => e.interestingness_score as number).sort((a, b) => a - b);
    const median = scores[Math.floor(scores.length / 2)];

    // Score distribution
    const ranges = [
        { min: 0, max: 10, label: '0-10' },
        { min: 10, max: 25, label: '10-25' },
        { min: 25, max: 50, label: '25-50' },
        { min: 50, max: 100, label: '50-100' },
        { min: 100, max: Infinity, label: '100+' },
    ];

    const distribution = ranges.map((r) => ({
        range: r.label,
        count: scores.filter((s) => s >= r.min && s < r.max).length,
    }));

    // Average breakdown
    const breakdownKeys = [
        'webRequest',
        'html_lines',
        'storage_local',
        'background_page',
        'content_scripts',
        'dangerous_permissions',
        'host_permissions',
        'crypto_patterns',
        'network_requests',
        'extension_size',
        'api_renames',
        'manifest_changes',
        'file_modifications',
        'webRequest_to_dnr_migrations',
    ] as const;

    const avgBreakdown: any = {};
    for (const key of breakdownKeys) {
        const values = withScores
            .filter((e) => e.interestingness_breakdown?.[key] !== undefined)
            .map((e) => e.interestingness_breakdown[key] as number);
        avgBreakdown[key] =
            values.length > 0 ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;
    }

    return {
        avgScore: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10,
        minScore: scores[0],
        maxScore: scores[scores.length - 1],
        medianScore: median,
        scoreDistribution: distribution,
        avgBreakdown,
    };
}

async function getLogTimingMetrics(db: Db, detailed: boolean): Promise<LogTimingMetrics> {
    const logs = db.collection('logs');

    // Find migration start/end logs
    const migrationLogs = await logs
        .find({
            $or: [
                { message: { $regex: /migration.*start/i } },
                { message: { $regex: /migration.*complete/i } },
                { message: { $regex: /migration.*finish/i } },
                { message: { $regex: /processing extension/i } },
                { message: { $regex: /migrated extension/i } },
            ],
        })
        .sort({ time: 1 })
        .toArray();

    let migrationStartTime: number | null = null;
    let migrationEndTime: number | null = null;

    // Find earliest start and latest end
    for (const log of migrationLogs) {
        if (log.message?.toLowerCase().includes('start')) {
            if (!migrationStartTime || log.time < migrationStartTime) {
                migrationStartTime = log.time;
            }
        }
        if (
            log.message?.toLowerCase().includes('complete') ||
            log.message?.toLowerCase().includes('finish')
        ) {
            if (!migrationEndTime || log.time > migrationEndTime) {
                migrationEndTime = log.time;
            }
        }
    }

    // Calculate per-extension timing from logs
    const extensionLogs = await logs
        .aggregate([
            { $match: { 'extension.id': { $exists: true } } },
            {
                $group: {
                    _id: '$extension.id',
                    name: { $first: '$extension.name' },
                    startTime: { $min: '$time' },
                    endTime: { $max: '$time' },
                },
            },
            {
                $project: {
                    id: '$_id',
                    name: 1,
                    durationMs: { $subtract: ['$endTime', '$startTime'] },
                },
            },
            { $sort: { durationMs: -1 } },
            { $limit: detailed ? 100 : 10 },
        ])
        .toArray();

    const extensionProcessingTimes = extensionLogs
        .filter((e) => e.durationMs > 0)
        .map((e) => ({
            id: e.id,
            name: e.name || 'Unknown',
            durationMs: e.durationMs,
        }));

    const totalDuration =
        migrationStartTime && migrationEndTime ? migrationEndTime - migrationStartTime : null;

    // Calculate average time per extension from the sampled data
    const avgTimePerExtension =
        extensionProcessingTimes.length > 0
            ? extensionProcessingTimes.reduce((a, b) => a + b.durationMs, 0) / extensionProcessingTimes.length
            : null;

    return {
        migrationStartTime,
        migrationEndTime,
        totalMigrationDurationMs: totalDuration,
        avgTimePerExtensionMs: avgTimePerExtension ? Math.round(avgTimePerExtension) : null,
        extensionProcessingTimes,
    };
}

async function getReportMetrics(db: Db): Promise<ReportMetrics> {
    const reports = db.collection('reports');

    const total = await reports.countDocuments();
    if (total === 0) {
        return {
            totalReports: 0,
            testedCount: 0,
            workingCount: 0,
            hasErrorsCount: 0,
            slowerCount: 0,
            avgVerificationDurationSecs: 0,
        };
    }

    const tested = await reports.countDocuments({ tested: true });
    const working = await reports.countDocuments({ overall_working: true });
    const hasErrors = await reports.countDocuments({ has_errors: true });
    const slower = await reports.countDocuments({ seems_slower: true });

    const durationStats = await reports
        .aggregate([
            { $match: { verification_duration_secs: { $exists: true, $gt: 0 } } },
            {
                $group: {
                    _id: null,
                    avgDuration: { $avg: '$verification_duration_secs' },
                },
            },
        ])
        .toArray();

    return {
        totalReports: total,
        testedCount: tested,
        workingCount: working,
        hasErrorsCount: hasErrors,
        slowerCount: slower,
        avgVerificationDurationSecs: Math.round((durationStats[0]?.avgDuration || 0) * 10) / 10,
    };
}

function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
    return `${(ms / 3600000).toFixed(2)}h`;
}

function printReport(report: PerformanceReport, detailed: boolean) {
    console.log('\n' + '='.repeat(80));
    console.log('EXTPORTER PERFORMANCE METRICS REPORT');
    console.log('='.repeat(80));
    console.log(`Generated: ${report.generatedAt}\n`);

    // Migration Statistics
    console.log('-'.repeat(40));
    console.log('MIGRATION STATISTICS');
    console.log('-'.repeat(40));
    console.log(`Total Extensions:      ${report.migration.totalExtensions}`);
    console.log(`Migrated:              ${report.migration.migratedExtensions}`);
    console.log(`Failed:                ${report.migration.failedExtensions}`);
    console.log(`Success Rate:          ${report.migration.migrationSuccessRate.toFixed(1)}%`);

    // Timing
    console.log('\n' + '-'.repeat(40));
    console.log('TIMING METRICS');
    console.log('-'.repeat(40));
    if (report.timing.totalMigrationDurationMs) {
        console.log(`Total Migration Time:  ${formatDuration(report.timing.totalMigrationDurationMs)}`);
    }
    if (report.timing.avgTimePerExtensionMs) {
        console.log(`Avg Time/Extension:    ${formatDuration(report.timing.avgTimePerExtensionMs)}`);
    }
    if (report.timing.extensionProcessingTimes.length > 0) {
        console.log('\nTop Extensions by Processing Time:');
        for (const ext of report.timing.extensionProcessingTimes.slice(0, 5)) {
            console.log(`  - ${ext.name.substring(0, 40).padEnd(40)} ${formatDuration(ext.durationMs)}`);
        }
    }

    // LLM Fix Metrics
    console.log('\n' + '-'.repeat(40));
    console.log('LLM FIX ATTEMPTS');
    console.log('-'.repeat(40));
    console.log(`Total Attempts:        ${report.llmFixes.totalAttempts}`);
    console.log(`Successful:            ${report.llmFixes.successfulAttempts}`);
    console.log(`Failed:                ${report.llmFixes.failedAttempts}`);
    console.log(`Success Rate:          ${report.llmFixes.successRate.toFixed(1)}%`);
    console.log(`Avg Duration:          ${formatDuration(report.llmFixes.avgDurationMs)}`);
    console.log(`Min Duration:          ${formatDuration(report.llmFixes.minDurationMs)}`);
    console.log(`Max Duration:          ${formatDuration(report.llmFixes.maxDurationMs)}`);
    console.log(`Avg Iterations:        ${report.llmFixes.avgIterations}`);
    console.log(`Total Files Modified:  ${report.llmFixes.totalFilesModified}`);

    // Validation Metrics
    console.log('\n' + '-'.repeat(40));
    console.log('FAKEIUM VALIDATION');
    console.log('-'.repeat(40));
    console.log(`Total Validated:       ${report.validation.totalValidated}`);
    console.log(`Equivalent:            ${report.validation.equivalentCount}`);
    console.log(`Non-Equivalent:        ${report.validation.nonEquivalentCount}`);
    console.log(`Avg Similarity Score:  ${report.validation.avgSimilarityScore}`);
    console.log(`Avg Validation Time:   ${formatDuration(report.validation.avgValidationDurationMs)}`);
    console.log(`Avg MV2 API Calls:     ${report.validation.avgMv2ApiCalls}`);
    console.log(`Avg MV3 API Calls:     ${report.validation.avgMv3ApiCalls}`);

    // Memory Metrics
    console.log('\n' + '-'.repeat(40));
    console.log('MEMORY USAGE');
    console.log('-'.repeat(40));
    console.log(`Memory Samples:        ${report.memory.samples}`);
    console.log(`Avg Heap Used:         ${report.memory.avgHeapUsedMB} MB`);
    console.log(`Max Heap Used:         ${report.memory.maxHeapUsedMB} MB`);
    console.log(`Avg RSS:               ${report.memory.avgRssMB} MB`);
    console.log(`Max RSS:               ${report.memory.maxRssMB} MB`);
    console.log(`GC Triggers:           ${report.memory.gcTriggerCount}`);

    // Interestingness Metrics
    console.log('\n' + '-'.repeat(40));
    console.log('EXTENSION COMPLEXITY (INTERESTINGNESS)');
    console.log('-'.repeat(40));
    console.log(`Average Score:         ${report.interestingness.avgScore}`);
    console.log(`Min Score:             ${report.interestingness.minScore}`);
    console.log(`Max Score:             ${report.interestingness.maxScore}`);
    console.log(`Median Score:          ${report.interestingness.medianScore}`);
    console.log('\nScore Distribution:');
    for (const bucket of report.interestingness.scoreDistribution) {
        const bar = '█'.repeat(Math.min(50, Math.round(bucket.count / 10)));
        console.log(`  ${bucket.range.padEnd(8)} ${bucket.count.toString().padStart(5)} ${bar}`);
    }

    if (detailed) {
        console.log('\nAverage Score Breakdown:');
        const breakdown = report.interestingness.avgBreakdown;
        const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
        for (const [key, value] of entries) {
            if (value > 0) {
                console.log(`  ${key.padEnd(30)} ${value}`);
            }
        }
    }

    // Report Metrics
    console.log('\n' + '-'.repeat(40));
    console.log('MANUAL TESTING REPORTS');
    console.log('-'.repeat(40));
    console.log(`Total Reports:         ${report.reports.totalReports}`);
    console.log(`Tested:                ${report.reports.testedCount}`);
    console.log(`Working:               ${report.reports.workingCount}`);
    console.log(`Has Errors:            ${report.reports.hasErrorsCount}`);
    console.log(`Seems Slower:          ${report.reports.slowerCount}`);
    console.log(`Avg Verification Time: ${report.reports.avgVerificationDurationSecs}s`);

    console.log('\n' + '='.repeat(80));
}

async function main() {
    const args = process.argv.slice(2);
    const outputJson = args.includes('--json');
    const detailed = args.includes('--detailed');
    const outputFileArg = args.find((arg) => arg.startsWith('--output='));
    const outputFile = outputFileArg ? outputFileArg.split('=')[1] : null;

    let client: MongoClient | null = null;

    try {
        const { client: c, db } = await connectToDatabase();
        client = c;

        console.log('Collecting performance metrics...\n');

        // Collect all metrics in parallel
        const [migration, llmFixes, validation, memory, interestingness, timing, reports] =
            await Promise.all([
                getMigrationMetrics(db),
                getLLMMetrics(db),
                getValidationMetrics(db),
                getMemoryMetrics(db),
                getInterestingnessMetrics(db),
                getLogTimingMetrics(db, detailed),
                getReportMetrics(db),
            ]);

        const report: PerformanceReport = {
            generatedAt: new Date().toISOString(),
            migration,
            llmFixes,
            validation,
            memory,
            interestingness,
            timing,
            reports,
        };

        // Print report to console
        if (!outputJson) {
            printReport(report, detailed);
        }

        // Output as JSON if requested
        if (outputJson) {
            console.log(JSON.stringify(report, null, 2));
        }

        // Save to file if requested
        if (outputFile) {
            const outputPath = path.resolve(outputFile);
            fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
            console.log(`\nReport saved to: ${outputPath}`);
        }
    } catch (error) {
        console.error('Error collecting metrics:', error);
        process.exit(1);
    } finally {
        if (client) {
            await client.close();
        }
    }
}

// Run the script
if (require.main === module) {
    main();
}

export { PerformanceReport, MigrationMetrics, LLMMetrics, ValidationMetrics, MemoryMetrics };
