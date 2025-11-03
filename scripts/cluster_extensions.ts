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

import * as dotenv from 'dotenv';
import { Database } from '../migrator/features/database/db_manager';
import chalk from 'chalk';
import {
    buildVocabulary,
    findOptimalClusters,
    clusterExtensions,
    needsMigration,
} from './clustering/clustering_utils';
import {
    loadExtensionsFromFilesystem,
    loadExtensionsFromDatabase,
    loadExtensionsFromOutput,
    groupAPIsByDomain,
} from './clustering/extension_loader';
import { ExtensionData } from './clustering/types';

dotenv.config();

// Shared functions are now imported from clustering_utils and extension_loader

async function main() {
    console.log(chalk.bold.cyan('\n🔬 Extension API Clustering Tool\n'));

    const args = process.argv.slice(2);

    // Auto-detect from .env file
    const envInputPath = process.env.INPUT_DIR;
    const envOutputPath = process.env.OUTPUT_DIR;
    const envMongoUri = process.env.MONGODB_URI;

    // Parse arguments
    let inputPath: string | null = null;
    let outputPath: string | null = null;
    let useDatabase = false;
    let numClusters: number | 'auto' = 'auto';
    let visualizationFile = './cluster_visualization.html';
    let autoMode = false;

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
            const val = args[++i];
            numClusters = val === 'auto' ? 'auto' : parseInt(val);
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
  -c, --clusters <num>     Number of clusters (default: auto)
  -v, --viz <file>         Output HTML file (default: ./cluster_visualization.html)
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

  # Override .env with specific path
  npm run cluster -- --input ./my-extensions

  # Compare .env input vs output
  npm run cluster -- --auto --database
            `);
            process.exit(0);
        }
    }

    // Apply .env defaults if not explicitly provided
    if (!inputPath && !outputPath && !useDatabase) {
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

    // Build vocabulary
    const vocabulary = buildVocabulary(allExtensions);
    console.log(chalk.blue(`Found ${vocabulary.length} unique API domains`));

    // Determine cluster count
    let finalClusterCount: number;
    if (numClusters === 'auto') {
        finalClusterCount = findOptimalClusters(allExtensions, vocabulary);
    } else {
        const requestedClusters =
            typeof numClusters === 'number' ? numClusters : parseInt(String(numClusters));
        if (isNaN(requestedClusters) || requestedClusters < 1) {
            console.log(chalk.red(`Invalid cluster count: ${numClusters}`));
            finalClusterCount = findOptimalClusters(allExtensions, vocabulary);
        } else {
            finalClusterCount = Math.min(requestedClusters, Math.floor(allExtensions.length / 2));
            console.log(
                chalk.blue(`Using ${finalClusterCount} clusters (requested: ${requestedClusters})`)
            );
        }
    }

    // Validate final cluster count
    if (isNaN(finalClusterCount) || finalClusterCount < 1) {
        console.log(
            chalk.red(`Error: Invalid cluster count (${finalClusterCount}). Using 5 as default.`)
        );
        finalClusterCount = Math.min(5, Math.floor(allExtensions.length / 2));
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
