#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import { exit } from 'process';
import chalk from 'chalk';
import { Database } from '../migrator/features/database/db_manager';
import { SearchOptions } from './types';
import { ExtensionExplorer } from './extension-explorer';
import * as actions from './extension-actions';

// Load environment variables
dotenv.config();

async function main() {
    const args = process.argv.slice(2);
    const options: SearchOptions = {};
    let directExtensionId: string | null = null;
    let directAction: string | null = null;

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--min-score' && i + 1 < args.length) {
            options.minScore = parseInt(args[++i]);
        } else if (arg === '--has-mv3') {
            options.hasMv3 = true;
        } else if (arg === '--no-mv3') {
            options.noMv3 = true;
        } else if (arg === '--permission' && i + 1 < args.length) {
            options.permission = args[++i];
        } else if (arg === '--pattern' && i + 1 < args.length) {
            options.pattern = args[++i];
        } else if (arg === '--name' && i + 1 < args.length) {
            options.nameFilter = args[++i];
        } else if (arg === '--view' || arg === '--compare' || arg === '--run') {
            directAction = arg.substring(2); // Remove '--'
        } else if (!arg.startsWith('--')) {
            directExtensionId = arg;
        }
    }

    if (!process.env.OUTPUT_DIR || !process.env.INPUT_DIR) {
        console.error('❌ OUTPUT_DIR and INPUT_DIR must be set in .env');
        exit(1);
    }

    const explorer = new ExtensionExplorer();

    // Handle SIGINT (Ctrl+C) gracefully
    let sigintCount = 0;
    process.on('SIGINT', async () => {
        sigintCount++;
        if (sigintCount === 1) {
            console.log('\n\n👋 Interrupted. Press Ctrl+C again to force quit.');
            try {
                explorer.close();
                await Database.shared.close();
            } catch (e) {
                // Ignore cleanup errors
            }
            exit(0);
        } else {
            console.log('\n\nForce quitting...');
            process.exit(1);
        }
    });

    try {
        await Database.shared.init();

        if (directExtensionId) {
            // Direct access to extension
            const extensions = await explorer.getAllExtensions();
            let ext = extensions.find(e => e.id === directExtensionId);

            if (!ext) {
                ext = extensions.find(e => e.mv3_extension_id === directExtensionId);
            }

            if (!ext) {
                console.log(`❌ Extension with ID ${directExtensionId} not found`);
                exit(1);
            }

            if (directAction === 'view') {
                await actions.viewSource(ext);
            } else if (directAction === 'compare') {
                await actions.compareExtensions(ext);
            } else if (directAction === 'run') {
                await actions.runExtension(ext);
            } else {
                const shouldContinue = await explorer.runActionLoop(ext);
                if (!shouldContinue) {
                    exit(0);
                }
            }
        } else {
            // Interactive search mode
            while (true) {
                console.log(chalk.blue('🔍 Loading extensions...'));
                const extensions = await explorer.getAllExtensions(options);

                if (extensions.length === 0) {
                    console.log('❌ No extensions found matching criteria');
                    break;
                }

                console.log(chalk.dim(`Found ${extensions.length} extensions`));

                const selected = await explorer.searchExtensions(extensions);

                if (!selected) {
                    console.log(chalk.cyan('\n👋 Goodbye!'));
                    break;
                }

                const shouldContinue = await explorer.runActionLoop(selected);
                if (!shouldContinue) {
                    console.log(chalk.cyan('\n👋 Goodbye!'));
                    break;
                }
            }
        }
    } catch (error) {
        console.error(chalk.red('❌ Error:'), error);
        exit(1);
    } finally {
        explorer.close();
        await Database.shared.close();
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}
