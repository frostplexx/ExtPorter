/**
 * Test script to validate a single extension with fakeium
 * Usage: ts-node tests/fakeium/test-single-extension.ts path/to/extension
 */

import path from 'path';
import fs from 'fs-extra';
import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';
import { FakeiumValidator } from '../../modules/fakeium_validator';
import { MigrateManifest } from '../../modules/manifest';
import { RenameAPIS } from '../../modules/api_renames';

/**
 * Load extension from directory
 */
function loadExtensionFromDirectory(extensionPath: string): Extension {
    const manifestPath = path.join(extensionPath, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
        throw new Error(`Manifest not found at: ${manifestPath}`);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const files: LazyFile[] = [];

    // Load all JavaScript files
    function addJsFiles(dir: string, baseDir: string) {
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                addJsFiles(fullPath, baseDir);
            } else if (item.endsWith('.js')) {
                const relativePath = path.relative(baseDir, fullPath);
                files.push(new LazyFile(relativePath, fullPath, ExtFileType.JS));
            }
        }
    }

    addJsFiles(extensionPath, extensionPath);

    const extensionId = path.basename(extensionPath);

    return {
        id: extensionId,
        name: manifest.name || extensionId,
        manifest_v2_path: extensionPath,
        manifest,
        files
    };
}

async function main() {
    const args = process.argv.slice(2);

    if (args.length === 0) {
        console.error('Usage: ts-node test-single-extension.ts <path-to-extension>');
        console.error('');
        console.error('Example:');
        console.error('  ts-node tests/fakeium/test-single-extension.ts tests/fixtures/mock-extensions/callback_extension');
        process.exit(1);
    }

    const extensionPath = path.resolve(args[0]);

    if (!fs.existsSync(extensionPath)) {
        console.error(`Error: Extension path does not exist: ${extensionPath}`);
        process.exit(1);
    }

    console.log('=== Fakeium Extension Validation Test ===\n');
    console.log(`Extension Path: ${extensionPath}\n`);

    try {
        // Load extension
        console.log('1. Loading extension...');
        let extension = loadExtensionFromDirectory(extensionPath);
        console.log(`   ✓ Loaded: ${extension.name}`);
        console.log(`   Files: ${extension.files.length} JavaScript files`);
        console.log('');

        // Migrate manifest
        console.log('2. Migrating manifest to MV3...');
        const migratedManifest = MigrateManifest.migrate(extension);
        if (migratedManifest && !('error' in migratedManifest)) {
            extension = migratedManifest;
            console.log(`   ✓ Manifest migrated`);
        } else {
            console.error('   ✗ Manifest migration failed');
            process.exit(1);
        }
        console.log('');

        // Optionally rename APIs
        console.log('3. Renaming APIs...');
        const renamedApis = RenameAPIS.migrate(extension);
        if (renamedApis && !('error' in renamedApis)) {
            extension = renamedApis;
            console.log(`   ✓ APIs renamed`);
        } else {
            console.log('   ! API renaming skipped or failed');
        }
        console.log('');

        // Run validation
        console.log('4. Running fakeium validation...');
        process.env.ENABLE_FAKEIUM_VALIDATION = 'true';
        process.env.FAKEIUM_TIMEOUT = '15000';

        // Enable verbose mode for debugging
        const verbose = process.env.FAKEIUM_VERBOSE === 'true';

        const validated = await FakeiumValidator.migrateAsync(extension);

        if (!validated || 'error' in validated) {
            console.error('   ✗ Validation failed to run');
            process.exit(1);
        }

        extension = validated;
        console.log('');

        // Display results
        console.log('=== Validation Results ===\n');

        if (!extension.fakeium_validation || !extension.fakeium_validation.enabled) {
            console.log('Validation was not enabled');
            process.exit(0);
        }

        const v = extension.fakeium_validation;

        console.log(`Status: ${v.is_equivalent ? '✓ PASSED' : '✗ FAILED'}`);
        console.log(`Similarity Score: ${(v.similarity_score * 100).toFixed(1)}%`);
        console.log(`Duration: ${v.duration_ms}ms`);
        console.log('');

        console.log('API Calls:');
        console.log(`  MV2: ${v.mv2_api_calls} calls`);
        console.log(`  MV3: ${v.mv3_api_calls} calls`);
        console.log(`  Matched: ${v.matched_calls}`);
        console.log(`  MV2-only: ${v.mv2_only_calls}`);
        console.log(`  MV3-only: ${v.mv3_only_calls}`);
        console.log('');

        if (v.differences.length > 0) {
            console.log('Differences Detected:');
            v.differences.forEach((diff, idx) => {
                console.log(`  ${idx + 1}. ${diff}`);
            });
            console.log('');
        }

        if (v.validation_errors.length > 0) {
            console.log('Validation Errors:');
            v.validation_errors.forEach((err, idx) => {
                console.log(`  ${idx + 1}. ${err}`);
            });
            console.log('');
        }

        // Summary
        const summary = FakeiumValidator.getValidationSummary(extension);
        console.log(`Summary: ${summary}`);
        console.log('');

        // Exit with appropriate code
        process.exit(v.is_equivalent ? 0 : 1);

    } catch (error) {
        console.error('\n✗ Error during validation:');
        console.error(error);
        process.exit(1);
    }
}

main();
