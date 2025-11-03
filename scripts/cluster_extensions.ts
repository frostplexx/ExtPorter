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
} from './clustering/clustering_utils';
import {
    loadExtensionsFromFilesystem,
    loadExtensionsFromDatabase,
    loadExtensionsFromOutput,
    loadExtensionsFromOutputWithMapping,
    groupAPIsByDomain,
    loadIDMappings,
} from './clustering/extension_loader';
import { ExtensionData } from './clustering/types';
import {
    calculateOverallStats,
    calculateClusterStats,
    printOverallStats,
    printClusterAnalysis,
    printAPIDomainAnalysis,
    printMigrationRecommendations,
    printEdgeCaseAPIs,
    printMigrationComparison,
    printInsights,
} from './clustering/output_formatter';
import { generateHTMLVisualization } from './clustering/html_generator';

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
        // Use database mapping if available for correct MV3 IDs
        const outputExtensions = useDatabase
            ? await loadExtensionsFromOutputWithMapping(outputPath)
            : await loadExtensionsFromOutput(outputPath);
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

    // Calculate statistics
    const overallStats = calculateOverallStats(allExtensions);
    const clusterStats = calculateClusterStats(clusters, allExtensions.length);

    // Print enhanced output
    printOverallStats(overallStats);

    // If we have both MV2 and MV3 extensions, show migration comparison
    const mv2Extensions = allExtensions.filter(
        (e) => e.source === 'filesystem' || e.source === 'database'
    );
    const mv3Extensions = allExtensions.filter((e) => e.source === 'output');
    let idMappings: Map<string, string> | undefined;
    if (mv2Extensions.length > 0 && mv3Extensions.length > 0) {
        // Load ID mappings from database (only if database was used)
        if (useDatabase) {
            idMappings = await loadIDMappings();
        }
        printMigrationComparison(mv2Extensions, mv3Extensions, idMappings);
    }

    printClusterAnalysis(clusters, clusterStats);
    printAPIDomainAnalysis(apiDomains, 15);
    printEdgeCaseAPIs(allExtensions);
    printMigrationRecommendations(allExtensions, apiDomains);
    printInsights(overallStats, clusterStats, apiDomains);

    // Generate HTML visualization
    const htmlOutputPath = visualizationFile || './cluster_visualization.html';
    generateHTMLVisualization(
        htmlOutputPath,
        allExtensions,
        clusters,
        apiDomains,
        overallStats,
        clusterStats,
        idMappings
    );

    if (useDatabase) {
        await Database.shared.close();
    }
}

main().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
});
