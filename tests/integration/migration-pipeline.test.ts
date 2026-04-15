import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { MigrateManifest } from '../../migrator/modules/manifest';
import { MigrateCSP } from '../../migrator/modules/csp';
import { ResourceDownloader } from '../../migrator/modules/resource_downloader';
import { Extension } from '../../migrator/types/extension';
import { MigrationError } from '../../migrator/types/migration_module';
import { SAMPLE_EXTENSIONS, createTestExtension } from '../fixtures/sample-extensions';

// Mock globals for testing
jest.mock('../../migrator/index', () => ({
    globals: {
        outputDir: process.env.TEST_OUTPUT_DIR + '/migration_pipeline_test',
        extensionsPath: '/test/extensions',
    },
}));

describe('Migration Pipeline Integration Tests', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'migration_pipeline_test');

    beforeEach(() => {
        fs.ensureDirSync(testDir);
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
    });

    describe('Simple Extension Migration', () => {
        it('should successfully migrate a simple extension through the complete pipeline', async () => {
            const extension = createTestExtension(SAMPLE_EXTENSIONS[0], testDir);

            // Step 1: Manifest Migration
            const manifestResult = await MigrateManifest.migrate(extension);
            expect(manifestResult).not.toBeInstanceOf(MigrationError);

            if (!(manifestResult instanceof MigrationError)) {
                // Verify manifest changes
                expect(manifestResult.manifest.manifest_version).toBe(3);
                expect(manifestResult.manifest.action).toBeDefined();
                expect(manifestResult.manifest.browser_action).toBeUndefined();
                expect(manifestResult.manifest.background.service_worker).toBe('background.js');

                // Step 2: CSP Migration
                const cspResult = await MigrateCSP.migrate(manifestResult);
                expect(cspResult).not.toBeInstanceOf(MigrationError);

                if (!(cspResult instanceof MigrationError)) {
                    expect(cspResult.manifest.content_security_policy).toBeDefined();
                    expect(cspResult.manifest.content_security_policy.extension_pages).toBeTruthy();

                    // Step 3: Resource Downloader (should not find any remote resources in simple extension)
                    const resourceResult = ResourceDownloader.migrate(cspResult);
                    expect(resourceResult).not.toBeInstanceOf(MigrationError);

                    if (!(resourceResult instanceof MigrationError)) {
                        // Simple extension should not have additional files added
                        expect(resourceResult.files.length).toBe(extension.files.length);
                    }

                    if (resourceResult instanceof MigrationError) {
                        return;
                    }
                    resourceResult.files.forEach((file) => file!.close());
                }
            }

            extension.files.forEach(
                (file) => {
                    if (file) {
                        file.close()
                    }
                }
            );
        });
    });

    describe('Complex Extension Migration', () => {
        it('should successfully migrate a complex extension with remote resources', async () => {
            const extension = createTestExtension(SAMPLE_EXTENSIONS[1], testDir);

            // Step 1: Manifest Migration
            const manifestResult = await MigrateManifest.migrate(extension);
            expect(manifestResult).not.toBeInstanceOf(MigrationError);

            if (!(manifestResult instanceof MigrationError)) {
                // Verify complex manifest changes
                expect(manifestResult.manifest.manifest_version).toBe(3);
                expect(manifestResult.manifest.permissions).toContain('declarativeNetRequest');
                expect(manifestResult.manifest.permissions).not.toContain('webRequestBlocking');
                expect(manifestResult.manifest.host_permissions).toContain('http://example.com/*');
                expect(manifestResult.manifest.web_accessible_resources).toEqual([
                    {
                        resources: ['images/*', 'css/injected.css'],
                        matches: ['*://*/*'],
                    },
                ]);

                // Step 2: Resource Downloader
                const resourceResult = ResourceDownloader.migrate(manifestResult);
                expect(resourceResult).not.toBeInstanceOf(MigrationError);

                if (!(resourceResult instanceof MigrationError)) {
                    // Complex extension should have additional downloaded files
                    expect(resourceResult.files.length).toBeGreaterThan(extension.files.length);

                    // Check that remote resources directory was created
                    const remoteResourcesDir = path.join(
                        testDir,
                        extension.mv3_extension_id!,
                        'remote_resources'
                    );
                    expect(fs.existsSync(remoteResourcesDir)).toBe(true);

                    // Verify that content was updated to use local resources
                    const contentFile = resourceResult.files.find((f) => f!.path === 'content.js');
                    expect(contentFile).toBeDefined();
                    if (contentFile) {
                        const content = contentFile.getContent();
                        expect(content).toContain('remote_resources/');
                        expect(content).not.toContain('https://fonts.googleapis.com/');
                    }

                    const cssFile = resourceResult.files.find((f) => f!.path === 'content.css');
                    expect(cssFile).toBeDefined();
                    if (cssFile) {
                        const content = cssFile.getContent();
                        expect(content).toContain('remote_resources/');
                        expect(content).not.toContain('https://stackpath.bootstrapcdn.com/');
                    }
                }

                if (resourceResult instanceof MigrationError) {
                    return;
                }
                resourceResult.files.forEach((file) => { if (file) { file.close() } });
            }

            extension.files.forEach((file) => { if (file) { file.close() } });
        });
    });

    describe('Migration Error Handling', () => {
        it('should handle corrupted extension gracefully', async () => {
            const corruptedExtension: Extension = {
                id: 'corrupted-extension',
                name: 'corrupted-extension',
                manifest_v2_path: testDir,
                manifest: null as any, // Corrupted manifest
                files: [],
            };

            const manifestResult = await MigrateManifest.migrate(corruptedExtension);
            expect(manifestResult).toBeInstanceOf(MigrationError);

            if (manifestResult instanceof MigrationError) {
                expect(manifestResult.extension).toBe(corruptedExtension);
                expect(manifestResult.error).toBeDefined();
            }
        });

        it('should handle extensions with missing files gracefully', () => {
            const extensionWithMissingFiles = createTestExtension(SAMPLE_EXTENSIONS[0], testDir);

            // Remove one of the files to simulate missing file
            const missingFilePath = path.join(testDir, SAMPLE_EXTENSIONS[0].name, 'background.js');
            fs.removeSync(missingFilePath);

            // Migration should still proceed
            const manifestResult = MigrateManifest.migrate(extensionWithMissingFiles);
            expect(manifestResult).not.toBeInstanceOf(MigrationError);

            extensionWithMissingFiles.files.forEach((file) => {
                try {
                    if (file) {
                        file.close();
                    }
                } catch (error) {
                    console.log(error as any);
                    // Expected for missing files
                }
            });
        });
    });

    describe('Migration Output Validation', () => {
        it('should create valid MV3 manifests', async () => {
            const extension = createTestExtension(SAMPLE_EXTENSIONS[1], testDir);
            let result = await MigrateManifest.migrate(extension);

            expect(result).not.toBeInstanceOf(MigrationError);
            if (!(result instanceof MigrationError)) {
                // Apply CSP migration
                result = await MigrateCSP.migrate(result);
                expect(result).not.toBeInstanceOf(MigrationError);
            }

            if (!(result instanceof MigrationError)) {
                const manifest = result.manifest;

                // Check required MV3 fields
                expect(manifest.manifest_version).toBe(3);
                expect(manifest.name).toBeTruthy();
                expect(manifest.version).toBeTruthy();

                // Check that old MV2 fields are removed
                expect(manifest.browser_action).toBeUndefined();
                expect(manifest.page_action).toBeUndefined();

                // Check that background is properly converted
                if (manifest.background) {
                    expect(manifest.background.scripts).toBeUndefined();
                    expect(manifest.background.persistent).toBeUndefined();
                    expect(manifest.background.service_worker).toBeTruthy();
                }

                // Check permissions structure
                if (manifest.permissions) {
                    expect(Array.isArray(manifest.permissions)).toBe(true);
                }
                if (manifest.host_permissions) {
                    expect(Array.isArray(manifest.host_permissions)).toBe(true);
                }

                // Check web_accessible_resources format
                if (manifest.web_accessible_resources) {
                    expect(Array.isArray(manifest.web_accessible_resources)).toBe(true);
                    manifest.web_accessible_resources.forEach((resource: any) => {
                        expect(resource).toHaveProperty('resources');
                        expect(resource).toHaveProperty('matches');
                        expect(Array.isArray(resource.resources)).toBe(true);
                        expect(Array.isArray(resource.matches)).toBe(true);
                    });
                }

                // Check CSP is added
                expect(manifest.content_security_policy).toBeDefined();
                expect(manifest.content_security_policy.extension_pages).toBeTruthy();
            }

            extension.files.forEach((file) => { if (file) { file.close() } });
        });

        it('should preserve important extension metadata', () => {
            SAMPLE_EXTENSIONS.forEach(async (fixture) => {
                const extension = createTestExtension(fixture, testDir);
                const result = await MigrateManifest.migrate(extension);

                expect(result).not.toBeInstanceOf(MigrationError);
                if (!(result instanceof MigrationError)) {
                    // Core metadata should be preserved
                    expect(result.manifest.name).toBe(fixture.manifest.name);
                    expect(result.manifest.version).toBe(fixture.manifest.version);
                    expect(result.manifest.description).toBe(fixture.manifest.description);

                    // Content scripts should be preserved
                    if (fixture.manifest.content_scripts) {
                        expect(result.manifest.content_scripts).toEqual(
                            fixture.manifest.content_scripts
                        );
                    }

                    // Options page should be preserved
                    if (fixture.manifest.options_page) {
                        expect(result.manifest.options_page).toBe(fixture.manifest.options_page);
                    }

                    // Chrome URL overrides should be preserved
                    if (fixture.manifest.chrome_url_overrides) {
                        expect(result.manifest.chrome_url_overrides).toEqual(
                            fixture.manifest.chrome_url_overrides
                        );
                    }
                }

                extension.files.forEach((file) => { if (file) { file.close() } });
            });
        });
    });
});
