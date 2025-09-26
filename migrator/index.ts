import dotenv from 'dotenv';
import { RenameAPIS } from "./modules/api_renames";
import { MigrateManifest } from "./modules/manifest";
import { ResourceDownloader } from "./modules/resource_downloader";
import { WriteMigrated } from "./modules/write_migrated";
import { MigrationWriter } from "./modules/migration_writer";
import { Extension, closeExtensionFiles } from "./types/extension";
import { find_extensions } from "./utils/find_extensions";
import { logger } from "./utils/logger";
import { Globals } from "./types/globals";
import { Database } from "./features/database/db_manager";
import { MigrationError } from './types/migration_module';

// Load environment variables once at application startup
dotenv.config();

// set global constants to be used accross the project
// its ugly but it works
export const globals: Globals = {
    extensionsPath: "",
    outputDir: "",
}

/**
 * Memory management utilities
 */
function formatMemoryUsage(memoryUsage: NodeJS.MemoryUsage): string {
    return `RSS: ${Math.round(memoryUsage.rss / 1024 / 1024)}MB, Heap Used: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB, Heap Total: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB`;
}

function logMemoryUsage(context: string): void {
    const memUsage = process.memoryUsage();
    logger.debug(null, `Memory usage [${context}]: ${formatMemoryUsage(memUsage)}`);
}

function forceGarbageCollection(): void {
    if (global.gc) {
        global.gc();
        logger.debug(null, "Forced garbage collection");
    } else {
        logger.debug(null, "Garbage collection not available. Run with --expose-gc flag for better memory management");
    }
}

/**
 * Set up database, global variables etc
 */
async function initialize() {
    await Database.shared.init()
    // Get folder path and output directory from command line arguments
    const args = process.argv.slice(2);

    globals.extensionsPath = args[0] || process.env.INPUT_DIR || "../extensions";
    globals.outputDir = args[1] || process.env.OUTPUT_DIR || "../output";
}

/**
 * Main function that runs the the migrator
 */
async function main() {

    await initialize()

    let extensions: Extension[] = []

    const startTime = performance.now();
    logMemoryUsage("startup");

    logger.info(null, `Starting extension search in: ${globals.extensionsPath}`);
    extensions = find_extensions(globals.extensionsPath)
    logMemoryUsage("after extension discovery");

    // Filter out new-tab extensions if setting is enabled
    const filterNewTab = process.env.FILTER_NEW_TAB_EXTENSIONS === 'true';
    if (filterNewTab) {
        const originalCount = extensions.length;
        extensions = extensions.filter(extension => !extension.isNewTabExtension)
        const filteredCount = originalCount - extensions.length;
        if (filteredCount > 0) {
            logger.info(null, `Filtered out ${filteredCount} new-tab extensions (FILTER_NEW_TAB_EXTENSIONS=true)`);
        }
    }

    // insert the found extensions in the database
    await Database.shared.insertFoundExtensions(extensions)

    // Close all file descriptors immediately after discovery to prevent FD leak
    extensions.forEach(extension => {
        closeExtensionFiles(extension);
    });


    logger.info(null, `Found ${extensions.length} extensions in ${globals.extensionsPath}`);
    logger.info(null, `Migration started. path: ${globals.extensionsPath}, found ${extensions.length} extensions`)

    // Migration modules (WriteMigrated should be last to queue completed migrations)
    const migrationModules = [
        MigrateManifest.migrate,
        ResourceDownloader.migrate,
        RenameAPIS.migrate,
        WriteMigrated.migrate
    ];

    let writeIndex = 0;
    const BATCH_SIZE = parseInt(process.env.MIGRATION_BATCH_SIZE || '50'); // Process extensions in batches
    const totalExtensions = extensions.length;

    logger.info(null, `Processing ${totalExtensions} extensions in batches of ${BATCH_SIZE}`);

    // Process extensions in batches to manage memory usage
    for (let batchStart = 0; batchStart < totalExtensions; batchStart += BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + BATCH_SIZE, totalExtensions);
        const currentBatch = extensions.slice(batchStart, batchEnd);

        logger.info(null, `Processing batch ${Math.floor(batchStart/BATCH_SIZE) + 1}/${Math.ceil(totalExtensions/BATCH_SIZE)}: extensions ${batchStart + 1}-${batchEnd}`);
        logMemoryUsage(`batch ${Math.floor(batchStart/BATCH_SIZE) + 1} start`);

        // Process each extension in the current batch
        for (let extension of currentBatch) {

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
            const written = WriteMigrated.migrate(extension);
            if (written && !(written instanceof MigrationError)) {
                extension = written;

                // Insert migrated extension to database immediately after successful migration
                try {
                    // Create a lightweight copy for database insertion
                    const dbExtension: Extension = {
                        ...extension,
                        files: [] // Remove files to reduce database size - the important data is in manifest and mv3_extension_id
                    };

                    await Database.shared.insertMigratedExtension(dbExtension);
                    logger.info(extension, `Successfully inserted migrated extension to database`);
                    writeIndex++;
                } catch (dbError) {
                    logger.error(extension, `Failed to insert migrated extension to database`, {
                        error: dbError instanceof Error ? dbError.message : String(dbError)
                    });
                }
            } else {
                migrationSuccessful = false;
                if (written instanceof MigrationError) {
                    logger.error(extension, `Migration error while writing extension: ${extension.name}`, {
                        error: written.error instanceof Error ? written.error.message : String(written.error)
                    });
                } else {
                    logger.error(extension, `Failed to write migrated extension: ${extension.name}`);
                }
            }
        }


            closeExtensionFiles(extension);
        }

        // Clean up memory after each batch
        logMemoryUsage(`batch ${Math.floor(batchStart/BATCH_SIZE) + 1} end`);
        forceGarbageCollection();

        // Flush the migration writer queue after each batch to prevent memory buildup
        await MigrationWriter.shared.flush();

        logger.info(null, `Completed batch ${Math.floor(batchStart/BATCH_SIZE) + 1}/${Math.ceil(totalExtensions/BATCH_SIZE)}`);
    }

    // Truncate array to remove unused slots
    extensions.length = writeIndex;

    logger.info(null, `Successfully migrated ${extensions.length} extensions`);

    // Clean up all file descriptors before finishing
    extensions.forEach(extension => {
        closeExtensionFiles(extension);
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Final memory cleanup
    logMemoryUsage("before final cleanup");
    forceGarbageCollection();

    // Flush the migration writer queue before finishing
    await MigrationWriter.shared.flush();

    // Note: Extensions are now inserted individually during migration to protect against crashes
    // This bulk insertion is kept as a safety net for any extensions that might have been missed
    logger.info(null, `Migration completed. Took ${duration}`, { extensionCount: extensions.length });
    logMemoryUsage("migration completed");


    await teardown()
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
    logger.error(null, 'Uncaught Exception:', error);
    // Don't exit - continue processing
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error(null, 'Unhandled Rejection at:', { promise, reason });
    // Don't exit - continue processing
});

main().catch(error => {
    logger.error(null, 'Main function failed:', error);
    process.exit(1);
});
