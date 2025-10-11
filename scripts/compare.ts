import dotenv from 'dotenv';
import { Database } from '../migrator/features/database/db_manager';
import { find_extensions } from '../migrator/utils/find_extensions';
import { Extension } from '../migrator/types/extension';
import { ChromeTester } from '../ext_tester/chrome_tester';
import { exit } from 'process';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    // Load environment variables once at application startup
    dotenv.config();

    if (!process.env.OUTPUT_DIR) {
        throw new Error('OUTPUT_DIR not set');
    }

    await Database.shared.init();

    const args = process.argv.slice(2);

    const extensionId = args[0];

    if (!extensionId) {
        console.log('Usage: yarn scripts:compare <extension id (MV2 or MV3)>');
        console.log('Example: yarn scripts:compare abcdef123456');
        exit(1);
    }

    console.log(`Looking for extension with ID: ${extensionId}`);

    // Try to find the extension in the database - first by MV2 ID, then by MV3 ID
    let dbExtension = await Database.shared.findExtension({ id: extensionId });

    // If not found by MV2 ID, try MV3 ID
    if (!dbExtension) {
        dbExtension = await Database.shared.findExtension({
            mv3_extension_id: extensionId,
        });
    }

    if (!dbExtension) {
        console.log(`Extension with ID ${extensionId} not found in database`);
        exit(1);
    }

    // Convert database document back to Extension
    const mv2_extension: Extension = {
        id: dbExtension.id,
        name: dbExtension.name,
        manifest_v2_path: dbExtension.manifest_v2_path,
        manifest: dbExtension.manifest,
        files: dbExtension.files || [],
        isNewTabExtension: dbExtension.isNewTabExtension,
        mv3_extension_id: dbExtension.mv3_extension_id,
        manifest_v3_path: dbExtension.manifest_v3_path,
    };

    console.log(
        `Found extension: ${mv2_extension.name} (MV2: ${mv2_extension.id}, MV3: ${mv2_extension.mv3_extension_id})`
    );

    // Determine MV3 extension path from database or fallback
    let mv3ExtensionPath: string | null = null;

    if (mv2_extension.manifest_v3_path) {
        const mv3Path = path.dirname(mv2_extension.manifest_v3_path);
        if (fs.existsSync(mv3Path)) {
            mv3ExtensionPath = mv3Path;
            console.log(`Found MV3 extension at: ${mv3Path}`);
        } else {
            console.log(`MV3 extension directory not found at: ${mv3Path}`);
        }
    }

    // Fallback to OUTPUT_DIR construction if manifest_v3_path not available or doesn't exist
    if (!mv3ExtensionPath && mv2_extension.mv3_extension_id) {
        const fallbackPath = `${process.env.OUTPUT_DIR}/${mv2_extension.mv3_extension_id}`;
        if (fs.existsSync(fallbackPath)) {
            mv3ExtensionPath = fallbackPath;
            console.log(`Found MV3 extension at: ${fallbackPath} (fallback)`);
        } else {
            console.log(`MV3 extension directory not found at: ${fallbackPath}`);
        }
    }

    if (!mv3ExtensionPath) {
        console.log('No MV3 extension directory found');
        exit(1);
    }

    // Parse the MV3 extension from the discovered path
    const migrated_parsed_ext = find_extensions(mv3ExtensionPath, true)[0];

    if (!migrated_parsed_ext) {
        console.log(`Could not parse migrated extension in ${mv3ExtensionPath}`);
        exit(1);
    }

    console.log(`Loaded MV3 extension: ${migrated_parsed_ext.name}`);

    console.log('MV3 browser will be red');
    console.log('MV2 browser will be blue');

    // Launch both browsers simultaneously by creating separate instances
    const mv3Tester = new ChromeTester();
    const mv2Tester = new ChromeTester();

    // Launch both in parallel
    await Promise.all([
        (async () => {
            console.log('Starting MV3 browser (red)...');
            await mv3Tester.initBrowser(migrated_parsed_ext, 3, false, true);
            await mv3Tester.injectColor('red');
            mv3Tester.navigateTo('https://www.nytimes.com/');
            mv3Tester.navigateTo('chrome://extensions');
        })(),
        (async () => {
            console.log('Starting MV2 browser (blue)...');
            await mv2Tester.initBrowser(mv2_extension, 3, true, true);
            await mv2Tester.injectColor('blue');
            mv2Tester.navigateTo('https://www.nytimes.com/');
            mv2Tester.navigateTo('chrome://extensions');
        })(),
    ]);

    await Database.shared.close();
}

main();
