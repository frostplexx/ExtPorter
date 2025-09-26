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

    logger.info(null, `Starting extension search in: ${globals.extensionsPath}`);
    extensions = find_extensions(globals.extensionsPath)

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
    // loop through each extension
    for (let extension of extensions) {

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


    // Truncate array to remove unused slots
    extensions.length = writeIndex;

    logger.info(null, `Successfully migrated ${extensions.length} extensions`);

    // Clean up all file descriptors before finishing
    extensions.forEach(extension => {
        closeExtensionFiles(extension);
    });

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Flush the migration writer queue before finishing
    await MigrationWriter.shared.flush();

    // Note: Extensions are now inserted individually during migration to protect against crashes
    // This bulk insertion is kept as a safety net for any extensions that might have been missed
    logger.info(null, `Migration completed. Took ${duration}`, { extensionCount: extensions.length })


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
