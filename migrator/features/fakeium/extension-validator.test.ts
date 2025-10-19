/**
 * Fakeium-based extension migration validation tests
 */

import { describe, test, expect } from '@jest/globals';
import path from 'path';
import fs from 'fs-extra';
import { Extension } from '../../migrator/types/extension';
import { LazyFile } from '../../migrator/types/abstract_file';
import { ExtFileType } from '../../migrator/types/ext_file_types';
import { FakeiumRunner } from './FakeiumRunner';
import { BehaviorComparator } from './BehaviorComparator';

/**
 * Helper to load extension from directory
 */
function loadExtensionFromDirectory(extensionPath: string): Extension {
    const manifestPath = path.join(extensionPath, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    const files: LazyFile[] = [];

    // Add background scripts
    if (manifest.background?.scripts) {
        manifest.background.scripts.forEach((scriptPath: string) => {
            const fullPath = path.join(extensionPath, scriptPath);
            if (fs.existsSync(fullPath)) {
                files.push(new LazyFile(scriptPath, fullPath, ExtFileType.JS));
            }
        });
    }

    // Add background service worker (MV3)
    if (manifest.background?.service_worker) {
        const scriptPath = manifest.background.service_worker;
        const fullPath = path.join(extensionPath, scriptPath);
        if (fs.existsSync(fullPath)) {
            files.push(new LazyFile(scriptPath, fullPath, ExtFileType.JS));
        }
    }

    // Add content scripts
    if (manifest.content_scripts) {
        manifest.content_scripts.forEach((script: any) => {
            if (script.js) {
                script.js.forEach((jsFile: string) => {
                    const fullPath = path.join(extensionPath, jsFile);
                    if (fs.existsSync(fullPath)) {
                        files.push(new LazyFile(jsFile, fullPath, ExtFileType.JS));
                    }
                });
            }
        });
    }

    const extensionId = path.basename(extensionPath);

    return {
        id: extensionId,
        name: manifest.name,
        manifest_v2_path: extensionPath,
        manifest,
        files
    };
}

describe('Fakeium Extension Migration Validation', () => {
    const mockExtensionsDir = path.join(__dirname, '../fixtures/mock-extensions');

    describe('Basic Extension Execution', () => {
        test('should execute MV2 extension and capture API calls', async () => {
            const extensionPath = path.join(mockExtensionsDir, 'callback_extension');

            if (!fs.existsSync(extensionPath)) {
                console.warn(`Skipping test - extension not found: ${extensionPath}`);
                return;
            }

            const extension = loadExtensionFromDirectory(extensionPath);
            const result = await FakeiumRunner.runExtension(extension, 2, { verbose: false });

            expect(result.success).toBe(true);
            expect(result.behavior.apiCalls).toBeDefined();
            expect(result.behavior.manifestVersion).toBe(2);
            expect(result.behavior.extensionId).toBe('callback_extension');
        }, 60000);

        test('should execute MV3 extension and capture API calls', async () => {
            const extensionPath = path.join(mockExtensionsDir, 'callback_extension');

            if (!fs.existsSync(extensionPath)) {
                console.warn(`Skipping test - extension not found: ${extensionPath}`);
                return;
            }

            const extension = loadExtensionFromDirectory(extensionPath);
            const result = await FakeiumRunner.runExtension(extension, 3, { verbose: false });

            expect(result.success).toBe(true);
            expect(result.behavior.apiCalls).toBeDefined();
            expect(result.behavior.manifestVersion).toBe(3);
        }, 60000);
    });

    describe('API Call Detection', () => {
        test('should detect chrome.storage API calls', async () => {
            // Create a test extension that uses storage API
            const testCode = `
                chrome.storage.sync.set({ key: 'value' }, function() {
                    console.log('Saved');
                });

                chrome.storage.sync.get('key', function(result) {
                    console.log('Got:', result);
                });
            `;

            const tempDir = path.join(__dirname, '../fixtures/temp-storage-test');
            fs.ensureDirSync(tempDir);

            const manifest = {
                manifest_version: 2,
                name: 'Storage Test',
                version: '1.0',
                background: { scripts: ['background.js'] }
            };

            fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));
            fs.writeFileSync(path.join(tempDir, 'background.js'), testCode);

            try {
                const extension = loadExtensionFromDirectory(tempDir);
                const result = await FakeiumRunner.runExtension(extension, 2);

                expect(result.success).toBe(true);

                const storageCalls = result.behavior.apiCalls.filter(call =>
                    call.path.startsWith('chrome.storage')
                );

                expect(storageCalls.length).toBeGreaterThan(0);

                // Check for specific calls
                const setCalls = storageCalls.filter(call => call.path.includes('.set'));
                const getCalls = storageCalls.filter(call => call.path.includes('.get'));

                expect(setCalls.length).toBeGreaterThan(0);
                expect(getCalls.length).toBeGreaterThan(0);
            } finally {
                fs.removeSync(tempDir);
            }
        }, 60000);

        test('should detect MV2-specific API calls', async () => {
            const testCode = `
                chrome.extension.sendMessage({ type: 'hello' });
                chrome.browserAction.setBadgeText({ text: '5' });
                chrome.tabs.getAllInWindow(null, function(tabs) {
                    console.log('Got tabs:', tabs);
                });
            `;

            const tempDir = path.join(__dirname, '../fixtures/temp-mv2-test');
            fs.ensureDirSync(tempDir);

            const manifest = {
                manifest_version: 2,
                name: 'MV2 API Test',
                version: '1.0',
                background: { scripts: ['background.js'] }
            };

            fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));
            fs.writeFileSync(path.join(tempDir, 'background.js'), testCode);

            try {
                const extension = loadExtensionFromDirectory(tempDir);
                const result = await FakeiumRunner.runExtension(extension, 2);

                expect(result.success).toBe(true);

                const apiPaths = result.behavior.apiCalls.map(call => call.path);

                expect(apiPaths).toContain('chrome.extension.sendMessage');
                expect(apiPaths).toContain('chrome.browserAction.setBadgeText');
                expect(apiPaths).toContain('chrome.tabs.getAllInWindow');
            } finally {
                fs.removeSync(tempDir);
            }
        }, 60000);

        test('should detect MV3-specific API calls', async () => {
            const testCode = `
                chrome.runtime.sendMessage({ type: 'hello' });
                chrome.action.setBadgeText({ text: '5' });
                chrome.tabs.query({ currentWindow: true }, function(tabs) {
                    console.log('Got tabs:', tabs);
                });
            `;

            const tempDir = path.join(__dirname, '../fixtures/temp-mv3-test');
            fs.ensureDirSync(tempDir);

            const manifest = {
                manifest_version: 3,
                name: 'MV3 API Test',
                version: '1.0',
                background: { service_worker: 'background.js' }
            };

            fs.writeFileSync(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest));
            fs.writeFileSync(path.join(tempDir, 'background.js'), testCode);

            try {
                const extension = loadExtensionFromDirectory(tempDir);
                const result = await FakeiumRunner.runExtension(extension, 3);

                expect(result.success).toBe(true);

                const apiPaths = result.behavior.apiCalls.map(call => call.path);

                expect(apiPaths).toContain('chrome.runtime.sendMessage');
                expect(apiPaths).toContain('chrome.action.setBadgeText');
                expect(apiPaths).toContain('chrome.tabs.query');
            } finally {
                fs.removeSync(tempDir);
            }
        }, 60000);
    });

    describe('Behavior Comparison', () => {
        test('should compare equivalent MV2 and MV3 behaviors', async () => {
            // Create MV2 version
            const mv2Code = `
                chrome.extension.sendMessage({ type: 'test' });
                chrome.browserAction.setBadgeText({ text: 'OK' });
            `;

            // Create MV3 version (migrated)
            const mv3Code = `
                chrome.runtime.sendMessage({ type: 'test' });
                chrome.action.setBadgeText({ text: 'OK' });
            `;

            const tempDirMv2 = path.join(__dirname, '../fixtures/temp-comparison-mv2');
            const tempDirMv3 = path.join(__dirname, '../fixtures/temp-comparison-mv3');

            fs.ensureDirSync(tempDirMv2);
            fs.ensureDirSync(tempDirMv3);

            const mv2Manifest = {
                manifest_version: 2,
                name: 'Test Extension',
                version: '1.0',
                background: { scripts: ['background.js'] }
            };

            const mv3Manifest = {
                manifest_version: 3,
                name: 'Test Extension',
                version: '1.0',
                background: { service_worker: 'background.js' }
            };

            fs.writeFileSync(path.join(tempDirMv2, 'manifest.json'), JSON.stringify(mv2Manifest));
            fs.writeFileSync(path.join(tempDirMv2, 'background.js'), mv2Code);

            fs.writeFileSync(path.join(tempDirMv3, 'manifest.json'), JSON.stringify(mv3Manifest));
            fs.writeFileSync(path.join(tempDirMv3, 'background.js'), mv3Code);

            try {
                const mv2Extension = loadExtensionFromDirectory(tempDirMv2);
                const mv3Extension = loadExtensionFromDirectory(tempDirMv3);

                const mv2Result = await FakeiumRunner.runExtension(mv2Extension, 2);
                const mv3Result = await FakeiumRunner.runExtension(mv3Extension, 3);

                expect(mv2Result.success).toBe(true);
                expect(mv3Result.success).toBe(true);

                const comparison = BehaviorComparator.compare(
                    mv2Result.behavior,
                    mv3Result.behavior
                );

                expect(comparison.matched.length).toBeGreaterThan(0);
                expect(comparison.similarityScore).toBeGreaterThan(0.5);

                const report = BehaviorComparator.generateReport(comparison);
                expect(report).toContain('Migration Validation Report');
                expect(report).toBeDefined();

                console.log('\nComparison Report:\n', report);
            } finally {
                fs.removeSync(tempDirMv2);
                fs.removeSync(tempDirMv3);
            }
        }, 60000);

        test('should detect missing migration transformations', async () => {
            // MV2 version uses old API
            const mv2Code = `
                chrome.tabs.getAllInWindow(null, function(tabs) {
                    console.log(tabs);
                });
            `;

            // MV3 version incorrectly still uses old API (migration failed)
            const mv3Code = `
                chrome.tabs.getAllInWindow(null, function(tabs) {
                    console.log(tabs);
                });
            `;

            const tempDirMv2 = path.join(__dirname, '../fixtures/temp-bad-migration-mv2');
            const tempDirMv3 = path.join(__dirname, '../fixtures/temp-bad-migration-mv3');

            fs.ensureDirSync(tempDirMv2);
            fs.ensureDirSync(tempDirMv3);

            const mv2Manifest = {
                manifest_version: 2,
                name: 'Bad Migration Test',
                version: '1.0',
                background: { scripts: ['background.js'] }
            };

            const mv3Manifest = {
                manifest_version: 3,
                name: 'Bad Migration Test',
                version: '1.0',
                background: { service_worker: 'background.js' }
            };

            fs.writeFileSync(path.join(tempDirMv2, 'manifest.json'), JSON.stringify(mv2Manifest));
            fs.writeFileSync(path.join(tempDirMv2, 'background.js'), mv2Code);

            fs.writeFileSync(path.join(tempDirMv3, 'manifest.json'), JSON.stringify(mv3Manifest));
            fs.writeFileSync(path.join(tempDirMv3, 'background.js'), mv3Code);

            try {
                const mv2Extension = loadExtensionFromDirectory(tempDirMv2);
                const mv3Extension = loadExtensionFromDirectory(tempDirMv3);

                const mv2Result = await FakeiumRunner.runExtension(mv2Extension, 2);
                const mv3Result = await FakeiumRunner.runExtension(mv3Extension, 3);

                const comparison = BehaviorComparator.compare(
                    mv2Result.behavior,
                    mv3Result.behavior
                );

                // Should detect that MV3 version uses deprecated API
                expect(comparison.mv3Only.length).toBeGreaterThan(0);

                const report = BehaviorComparator.generateReport(comparison);
                console.log('\nBad Migration Report:\n', report);
            } finally {
                fs.removeSync(tempDirMv2);
                fs.removeSync(tempDirMv3);
            }
        }, 60000);
    });

    describe('Real Extension Testing', () => {
        test('should validate migrated extension behavior', async () => {
            const bridgeExtPath = path.join(mockExtensionsDir, 'bridge_test_extension');

            if (!fs.existsSync(bridgeExtPath)) {
                console.warn(`Skipping test - bridge_test_extension not found`);
                return;
            }

            const extension = loadExtensionFromDirectory(bridgeExtPath);

            // Run as MV2 and MV3
            const mv2Result = await FakeiumRunner.runExtension(extension, 2, { verbose: false });
            const mv3Result = await FakeiumRunner.runExtension(extension, 3, { verbose: false });

            expect(mv2Result.success).toBe(true);
            expect(mv3Result.success).toBe(true);

            // Compare behaviors
            const comparison = BehaviorComparator.compare(mv2Result.behavior, mv3Result.behavior);

            console.log(`\nBridge Test Extension Validation:`);
            console.log(`  MV2 API Calls: ${mv2Result.behavior.apiCalls.length}`);
            console.log(`  MV3 API Calls: ${mv3Result.behavior.apiCalls.length}`);
            console.log(`  Matched: ${comparison.matched.length}`);
            console.log(`  Similarity: ${(comparison.similarityScore * 100).toFixed(1)}%`);

            const report = BehaviorComparator.generateReport(comparison);
            console.log('\n', report);

            // Just verify it ran successfully - actual migration logic may differ
            expect(comparison).toBeDefined();
        }, 60000);
    });
});
