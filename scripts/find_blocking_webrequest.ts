#!/usr/bin/env ts-node

import { readdirSync, existsSync, readFileSync, lstatSync } from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import JSON5 from 'json5';

// Load environment variables
dotenv.config();

/**
 * Script to identify Chrome extensions that use blocking webRequest API.
 *
 * This script analyzes extensions and identifies those that:
 * 1. Have webRequest or webRequestBlocking permissions in their manifest
 *
 * Usage:
 *   ts-node scripts/find_blocking_webrequest.ts [path_to_extensions_directory]
 */

interface BlockingWebRequestInfo {
    extensionId: string;
    extensionName: string;
    manifestPath: string;
    hasWebRequestPermission: boolean;
    hasWebRequestBlockingPermission: boolean;
}

/**
 * Find all manifest.json files in a directory
 */
function findManifests(dirPath: string): string[] {
    const manifests: string[] = [];

    try {
        const items = readdirSync(dirPath);

        for (const item of items) {
            const itemPath = path.join(dirPath, item);

            if (!lstatSync(itemPath).isDirectory()) {
                continue;
            }

            const manifestPath = path.join(itemPath, 'manifest.json');

            if (existsSync(manifestPath)) {
                manifests.push(manifestPath);
            }
        }
    } catch (error) {
        console.error(`Error reading directory ${dirPath}:`, error);
    }

    return manifests;
}

/**
 * Parse manifest and check for webRequest permissions
 */
function analyzeManifest(manifestPath: string): BlockingWebRequestInfo | null {
    try {
        const content = readFileSync(manifestPath, 'utf-8');
        const manifest = JSON5.parse(content);

        // Only process MV2 extensions
        if (manifest.manifest_version !== 2) {
            return null;
        }

        const permissions = manifest.permissions || [];
        const hasWebRequest = permissions.includes('webRequest');
        const hasWebRequestBlocking = permissions.includes('webRequestBlocking');

        // Only return info if extension has webRequest permissions
        if (!hasWebRequest && !hasWebRequestBlocking) {
            return null;
        }

        const extensionName = manifest.name || 'Unknown';
        const extensionDir = path.dirname(manifestPath);
        const extensionId = path.basename(extensionDir);

        return {
            extensionId,
            extensionName,
            manifestPath: extensionDir,
            hasWebRequestPermission: hasWebRequest,
            hasWebRequestBlockingPermission: hasWebRequestBlocking,
        };
    } catch (error) {
        // Silently skip invalid manifests
        return null;
    }
}

/**
 * Main function
 */
function main() {
    const args = process.argv.slice(2);

    // Filter out flag arguments
    const pathArgs = args.filter(arg => !arg.startsWith('--'));

    // Use INPUT_DIR from .env if no path argument provided
    let extensionsPath: string;

    if (pathArgs.length === 0) {
        extensionsPath = process.env.INPUT_DIR || '';

        if (!extensionsPath) {
            console.error('Usage: ts-node scripts/find_blocking_webrequest.ts [path_to_extensions]');
            console.error('Or set INPUT_DIR in .env file');
            process.exit(1);
        }

        console.log(`Using INPUT_DIR from .env: ${extensionsPath}\n`);
    } else {
        extensionsPath = pathArgs[0];
    }

    console.log(`Searching for extensions in: ${extensionsPath}\n`);

    // Find all manifest files
    const manifests = findManifests(extensionsPath);
    console.log(`Found ${manifests.length} extensions to analyze\n`);

    // Analyze each manifest
    const results: BlockingWebRequestInfo[] = [];
    let processedCount = 0;

    for (const manifestPath of manifests) {
        processedCount++;

        if (processedCount % 500 === 0) {
            console.log(`Progress: ${processedCount}/${manifests.length} manifests processed...`);
        }

        const info = analyzeManifest(manifestPath);
        if (info) {
            results.push(info);
        }
    }

    console.log(`\nProcessing complete: ${processedCount}/${manifests.length} extensions analyzed\n`);

    // Print results
    console.log('='.repeat(80));
    console.log('EXTENSIONS USING WEBREQUEST PERMISSIONS');
    console.log('='.repeat(80));
    console.log();

    if (results.length === 0) {
        console.log('No extensions found with webRequest permissions.');
        return;
    }

    console.log(`Found ${results.length} extension(s) with webRequest permissions:\n`);

    results.forEach((result, index) => {
        console.log(`${index + 1}. ${result.extensionName}`);
        console.log(`   ID: ${result.extensionId}`);
        console.log(`   Path: ${result.manifestPath}`);
        console.log(`   Permissions:`);
        console.log(`     - webRequest: ${result.hasWebRequestPermission ? 'YES' : 'NO'}`);
        console.log(`     - webRequestBlocking: ${result.hasWebRequestBlockingPermission ? 'YES' : 'NO'}`);
        console.log();
    });

    // Summary statistics
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total extensions with webRequest permissions: ${results.length}`);
    console.log(`Extensions with webRequest permission: ${results.filter(r => r.hasWebRequestPermission).length}`);
    console.log(`Extensions with webRequestBlocking permission: ${results.filter(r => r.hasWebRequestBlockingPermission).length}`);

    // Export to JSON if requested
    if (args.includes('--json')) {
        const jsonOutput = JSON.stringify(results, null, 2);
        console.log('\n' + '='.repeat(80));
        console.log('JSON OUTPUT');
        console.log('='.repeat(80));
        console.log(jsonOutput);
    }

    // Save to file if requested
    const outputFileArg = args.find(arg => arg.startsWith('--output='));
    if (outputFileArg) {
        const outputPath = outputFileArg.split('=')[1];
        const fs = require('fs');
        fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`\nResults saved to: ${outputPath}`);
    }
}

// Run the script
if (require.main === module) {
    main();
}

export { BlockingWebRequestInfo };
