import dotenv from 'dotenv';
import * as path from 'path';
import { RenameAPIS } from './modules/api_renames';
import { MigrateManifest } from './modules/manifest';
import { WriteMigrated } from './modules/write_migrated';
import { MigrationWriter } from './modules/migration_writer';
import { InterestingnessScorer } from './modules/interestingness_scorer';
import { Extension, closeExtensionFiles } from './types/extension';
import { find_extensions } from './utils/find_extensions';
import { logger } from './utils/logger';
import { Globals } from './types/globals';
import { Database } from './features/database/db_manager';
import { MigrationError } from './types/migration_module';
import { ResourceDownloader } from './modules/resource_downloader';

// Load environment variables once at application startup
dotenv.config();

// set global constants to be used accross the project
// its ugly but it works
export const globals: Globals = {
    extensionsPath: '',
    outputDir: '',
};

/**
 * Memory management utilities
 */
function formatMemoryUsage(memoryUsage: NodeJS.MemoryUsage): string {
    return `RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`;
}

function logMemoryUsage(context: string): void {
    const memUsage = process.memoryUsage();
    const isMonitoringEnabled = process.env.MEMORY_MONITORING === 'true';

    if (isMonitoringEnabled) {
        logger.info(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
    } else {
        logger.debug(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
    }
}

function forceGarbageCollection(): void {
    const isMonitoringEnabled = process.env.MEMORY_MONITORING === 'true';

    if (global.gc) {
        const beforeGC = process.memoryUsage();
        global.gc();
        const afterGC = process.memoryUsage();

        if (isMonitoringEnabled) {
            const freedMB = Math.round((beforeGC.heapUsed - afterGC.heapUsed) / 1024 / 1024);
            logger.info(null, `Forced garbage collection completed, freed ${freedMB}MB`);
        } else {
            logger.debug(null, 'Forced garbage collection');
        }
    } else {
        if (isMonitoringEnabled) {
            logger.warn(
                null,
                'Garbage collection not available. Run with --expose-gc flag for better memory management'
            );
        } else {
            logger.debug(
                null,
                'Garbage collection not available. Run with --expose-gc flag for better memory management'
            );
        }
    }
}

function checkMemoryThreshold(): boolean {
    const memUsage = process.memoryUsage();
    const heapUsedGB = memUsage.heapUsed / 1024 / 1024 / 1024;
    const rssGB = memUsage.rss / 1024 / 1024 / 1024;

    // Warning at 3GB, critical at 3.5GB
    if (heapUsedGB > 3.5 || rssGB > 3.5) {
        logger.error(
            null,
            `CRITICAL: Memory usage too high! Heap: ${heapUsedGB.toFixed(2)}GB, RSS: ${rssGB.toFixed(2)}GB`
        );
        return false;
    } else if (heapUsedGB > 3.0 || rssGB > 3.0) {
        logger.warn(
            null,
            `WARNING: High memory usage detected! Heap: ${heapUsedGB.toFixed(2)}GB, RSS: ${rssGB.toFixed(2)}GB`
        );
    }

    return true;
}

function clearExtensionMemory(extension: Extension): void {
    // Close all file descriptors
    closeExtensionFiles(extension);

    // Clear file contents and ASTs from memory
    extension.files.forEach((file) => {
        if (file.cleanContent) {
            file.cleanContent(); // This exists in LazyFile
        }
    });

    // Clear the files array
    extension.files.length = 0;

    // Clear large manifest data (keep minimal info for logging)
    const extensionName = extension.name;
    const extensionId = extension.id;

    // Clear manifest but keep essential fields for potential logging
    extension.manifest = {
        name: extensionName,
        manifest_version: extension.manifest.manifest_version,
    };
}

/**
 * Set up database, global variables etc
 */
async function initialize() {
    await Database.shared.init();
    // Get folder path and output directory from command line arguments
    const args = process.argv.slice(2);

    globals.extensionsPath = args[0] || process.env.INPUT_DIR || '../extensions';
    globals.outputDir = args[1] || process.env.OUTPUT_DIR || '../output';
}

/**
 * Main function that runs the the migrator
 */
async function main() {
    await initialize();

    let extensions: Extension[] = [];

    const startTime = performance.now();
    logMemoryUsage('startup');

    logger.info(null, `Starting extension search in: ${globals.extensionsPath}`);
    extensions = find_extensions(globals.extensionsPath);
    logMemoryUsage('after extension discovery');

    // Filter out new-tab extensions if setting is enabled
    const filterNewTab = process.env.FILTER_NEW_TAB_EXTENSIONS === 'true';
    if (filterNewTab) {
        const originalCount = extensions.length;
        extensions = extensions.filter((extension) => !extension.isNewTabExtension);
        const filteredCount = originalCount - extensions.length;
        if (filteredCount > 0) {
            logger.info(
                null,
                `Filtered out ${filteredCount} new-tab extensions (FILTER_NEW_TAB_EXTENSIONS=true)`
            );
        }
    }

    // insert the found extensions in the database
    await Database.shared.insertFoundExtensions(extensions);

    // Close all file descriptors immediately after discovery to prevent FD leak
    extensions.forEach((extension) => {
        closeExtensionFiles(extension);
    });

    logger.info(null, `Found ${extensions.length} extensions in ${globals.extensionsPath}`);
    logger.info(
        null,
        `Migration started. path: ${globals.extensionsPath}, found ${extensions.length} extensions`
    );

    // Migration modules (WriteMigrated should be last to queue completed migrations)
    const migrationModules = [
        MigrateManifest.migrate,
        ResourceDownloader.migrate,
        RenameAPIS.migrate,
        InterestingnessScorer.migrate,
        WriteMigrated.migrate,
    ];

    let writeIndex = 0;
    const BATCH_SIZE = parseInt(process.env.MIGRATION_BATCH_SIZE || '10'); // Much smaller default batch size to prevent OOM
    const totalExtensions = extensions.length;

    logger.info(
        null,
        `Processing ${totalExtensions} extensions in batches of ${BATCH_SIZE} (use MIGRATION_BATCH_SIZE to override)`
    );

    // Process extensions in batches to manage memory usage
    for (let batchStart = 0; batchStart < totalExtensions; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalExtensions);

        logger.info(
            null,
            `Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(totalExtensions / BATCH_SIZE)}: extensions ${batchStart + 1}-${batchEnd}`
        );
        logMemoryUsage(`batch ${Math.floor(batchStart / BATCH_SIZE) + 1} start`);

        // Process each extension in the current batch
        for (let i = batchStart; i < batchEnd; i++) {
            let extension = extensions[i];

            // Check memory usage before processing each extension
            if (!checkMemoryThreshold()) {
                logger.error(null, 'Memory usage too high, stopping migration to prevent crash');
                break;
            }

            let migrationSuccessful = true;
            // Run through migration pipeline (excluding WriteMigrated for now)
            const migrationOnly = migrationModules.slice(0, -1); // All except WriteMigrated
            for (const migrateFunction of migrationOnly) {
                // logger.info(extension, `Applying migration function: ${migrateFunction.name}`);
                const migrated = migrateFunction(extension); // call migrate function of each module.
                if (migrated && !(migrated instanceof MigrationError)) {
                    // if not null assign migrated extension to current one
                    extension = migrated;
                } else {
                    migrationSuccessful = false;
                    break;
                }
            }

            // Write the migrated extension to disk
            if (migrationSuccessful) {
                logger.info(extension, `Writing migrated extension: ${extension.name}`);

                // Instead of using async queue, write synchronously to avoid memory clearing issues
                try {
                    // Set the manifest_path for the MV3 extension
                    const useNewTabSubfolder = process.env.NEW_TAB_SUBFOLDER === 'true';
                    const isNewTab = extension.isNewTabExtension || false;
                    const extensionId = extension.mv3_extension_id || extension.id;

                    let outputPath: string;
                    if (useNewTabSubfolder && isNewTab) {
                        outputPath = path.join(
                            globals.outputDir,
                            'new_tab_extensions',
                            extensionId
                        );
                    } else {
                        outputPath = path.join(globals.outputDir, extensionId);
                    }

                    // Write extension synchronously to ensure it completes before memory cleanup
                    await MigrationWriter.shared.writeExtensionSync(extension, outputPath);

                    // Insert migrated extension to database immediately after successful migration
                    try {
                        // Create a lightweight copy for database insertion
                        const dbExtension: Extension = {
                            ...extension,
                            manifest_v3_path: path.join(outputPath, 'manifest.json'), // Set the MV3 manifest path
                            files: [], // Remove files to reduce database size - the important data is in manifest and mv3_extension_id
                        };

                        await Database.shared.insertMigratedExtension(dbExtension);
                        logger.info(
                            extension,
                            `Successfully inserted migrated extension to database`
                        );
                        writeIndex++;
                    } catch (dbError) {
                        logger.error(extension, `Failed to insert migrated extension to database`, {
                            error: dbError instanceof Error ? dbError.message : String(dbError),
                        });
                    }
                } catch (writeError) {
                    migrationSuccessful = false;
                    logger.error(
                        extension,
                        `Failed to write migrated extension: ${extension.name}`,
                        {
                            error:
                                writeError instanceof Error
                                    ? writeError.message
                                    : String(writeError),
                        }
                    );
                }
            }

            // CRITICAL: Clear extension from memory after processing
            clearExtensionMemory(extension);

            // Clear the reference in the extensions array to allow GC
            extensions[i] = null as any;

            // More aggressive cleanup after each extension
            if (writeIndex % 5 === 0) {
                // Force GC every 5 extensions
                forceGarbageCollection();
            }
        }

        // Clean up memory after each batch
        logMemoryUsage(`batch ${Math.floor(batchStart / BATCH_SIZE) + 1} end`);
        forceGarbageCollection();

        // Check memory health after cleanup
        if (!checkMemoryThreshold()) {
            logger.error(
                null,
                'Critical memory usage detected after batch cleanup. Stopping migration to prevent crash.'
            );
            logger.info(
                null,
                `Migration stopped after processing ${writeIndex} extensions due to memory constraints.`
            );
            break;
        }

        // Flush the migration writer queue after each batch to prevent memory buildup
        await MigrationWriter.shared.flush();

        logger.info(
            null,
            `Completed batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(totalExtensions / BATCH_SIZE)}`
        );
    }

    logger.info(null, `Successfully migrated ${writeIndex} extensions`);

    // Clear the extensions array completely to free memory
    extensions.length = 0;

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Final memory cleanup
    logMemoryUsage('before final cleanup');
    forceGarbageCollection();

    // Flush the migration writer queue before finishing
    await MigrationWriter.shared.flush();

    // Note: Extensions are now inserted individually during migration to protect against crashes
    // This bulk insertion is kept as a safety net for any extensions that might have been missed
    logger.info(null, `Migration completed. Took ${duration}`, {
        extensionCount: extensions.length,
    });
    logMemoryUsage('migration completed');

    await teardown();
}

/**
 * Closes logger, database connection and other stuff
 */
async function teardown() {
    // Flush any remaining logs to database before closing
    await logger.flush();
    // Stop logging timers to prevent further attempts
    logger.stop();
    // Close database connection
    await Database.shared.close();
}

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error);
    // Don't exit - continue processing
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', { promise, reason });
    // Don't exit - continue processing
});

main().catch((error) => {
    console.error('[MAIN FAILED]', error);
    process.exit(1);
});
