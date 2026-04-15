import dotenv from 'dotenv';
import { logger } from './utils/logger';
import { Globals } from './types/globals';
import { Database } from './features/database/db_manager';
import { MigrationServer } from './features/server/app';
import { releaseApiMappings } from './modules/api_renames/api-mappings-loader';

// Load environment variables once at application startup
console.log('📝 Loading environment variables...');
dotenv.config();
console.log('✅ Environment variables loaded');

// set global constants to be used accross the project
// its ugly but it works
export const globals: Globals = {
    extensionsPath: '',
    outputDir: '',
};

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
    print_info();
    const server = new MigrationServer(globals);

    await server.start();

    // Keep the server running and handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nShutting down server...');
        await server.close();
        await teardown();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\nShutting down server...');
        await server.close();
        await teardown();
        process.exit(0);
    });

    console.log('Migration server started. Press Ctrl+C to stop.');

    // Keep the process alive
    return new Promise(() => {});
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

    releaseApiMappings();
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

// Only run main if not in test environment and file is run directly
if (process.env.NODE_ENV !== 'test' && require.main === module) {
    main().catch((error) => {
        console.error('[MAIN FAILED]', error);
        process.exit(1);
    });
}

/**
 * Print info about server and environment,
 * e.g. RAM limits, Node version, LLM model and so on
 */
function print_info() {
    try {
        // Load OS functions if available (works in CommonJS-aware environments)
        let os: any = null;
        try {
            os = require('os');
        } catch {
            // In some environments require might not be available — that's fine, we will still print process-level info.
            os = null;
        }

        const toMB = (bytes?: number) => {
            if (!bytes && bytes !== 0) return '0 MB';
            return `${Math.round((bytes! / 1024 / 1024) * 100) / 100} MB`;
        };

        console.log('==== Environment and Server Info ====');
        console.log(`Node Version: ${process.version}`);

        // Print total system memory first
        if (os && typeof os.totalmem === 'function') {
            console.log(`System Memory Total: ${toMB(os.totalmem())}`);
        } else {
            console.log('System Memory Total: not available');
        }

        // Determine Node max memory (prefer explicit flag in execArgv, then NODE_OPTIONS, then v8 heap limit)
        let nodeMaxBytes: number | null = null;
        let nodeMaxSource = '';

        const arg = process.execArgv.find((a) => a.startsWith('--max-old-space-size'));
        if (arg) {
            const m = arg.match(/--max-old-space-size(?:=(\d+))?/);
            if (m && m[1]) {
                nodeMaxBytes = parseInt(m[1], 10) * 1024 * 1024;
                nodeMaxSource = '--max-old-space-size';
            }
        }

        if (!nodeMaxBytes && process.env.NODE_OPTIONS) {
            const m = process.env.NODE_OPTIONS.match(/--max-old-space-size=(\d+)/);
            if (m && m[1]) {
                nodeMaxBytes = parseInt(m[1], 10) * 1024 * 1024;
                nodeMaxSource = 'NODE_OPTIONS';
            }
        }

        if (!nodeMaxBytes) {
            try {
                const v8 = require('v8');
                const stats =
                    typeof v8.getHeapStatistics === 'function' ? v8.getHeapStatistics() : null;
                if (stats && typeof stats.heap_size_limit === 'number') {
                    nodeMaxBytes = stats.heap_size_limit;
                    nodeMaxSource = 'v8.getHeapStatistics().heap_size_limit';
                }
            } catch {
                // ignore if v8 isn't available
            }
        }

        if (nodeMaxBytes !== null) {
            console.log(
                `Node Max Memory (max heap): ${toMB(nodeMaxBytes)}${nodeMaxSource ? ` (${nodeMaxSource})` : ''}`
            );
        } else {
            console.log('Node Max Memory (max heap): not available');
        }

        if (os) {
            const cpus = os.cpus() || [];
            console.log(`CPU Count: ${cpus.length}`);
            console.log(`CPU Model: ${cpus[0]?.model ?? 'unknown'}`);
            console.log(`System Memory Free: ${toMB(os.freemem())}`);
        }

        console.log(`Working Directory: ${process.cwd()}`);

        console.log(
            `Extensions Path: ${globals.extensionsPath || process.env.INPUT_DIR || 'not set'}`
        );
        console.log(`Output Dir: ${globals.outputDir || process.env.OUTPUT_DIR || 'not set'}`);

        const llmModel = process.env.LLM_MODEL || 'not set';
        console.log(`LLM Model: ${llmModel}`);

        console.log('==== End Info ====');
    } catch (err) {
        console.error('[print_info] Failed to gather environment info', err);
    }
}
