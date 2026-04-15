import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { Database } from '../../../migrator/features/database/db_manager';
import { Extension } from '../../../migrator/types/extension';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Tests for the migration resume functionality.
 * 
 * The resume feature allows the migrator to:
 * 1. Continue from where it left off when restarted
 * 2. Skip extensions that have already been migrated
 * 3. Use both database records and disk folders to determine what's been done
 */
describe('Migration Resume Functionality', () => {
    let db: Database;
    let tempOutputDir: string;

    beforeAll(async () => {
        // Skip tests if MongoDB is not available
        if (!process.env.MONGODB_URI) {
            console.warn('Skipping resume tests - MongoDB not available');
            return;
        }

        db = Database.shared;

        try {
            // Only init if not already initialized
            if (!db.database) {
                await db.init();
            }
        } catch (error) {
            console.warn('Could not connect to MongoDB for testing:', error);
            db = undefined as any;
            return;
        }
    });

    afterAll(async () => {
        // Don't close the shared database instance as other tests may need it
    });

    describe('Database: getMigratedExtensionIds', () => {
        const testExtensions: Extension[] = [];

        beforeEach(async () => {
            if (!db) return;
            // Clear test extensions array
            testExtensions.length = 0;
        });

        it('should return empty sets when no extensions are migrated', async () => {
            if (!db) return;

            // Query for migrated extensions (there may be some from previous tests)
            const result = await db.getMigratedExtensionIds();

            expect(result).toBeDefined();
            expect(result.sourceIds).toBeInstanceOf(Set);
            expect(result.mv3Ids).toBeInstanceOf(Set);
            expect(result.mv3ToSourceMap).toBeInstanceOf(Map);
        });

        it('should return source IDs for migrated extensions', async () => {
            if (!db) return;

            const uniqueId = `resume-test-source-${Date.now()}-${Math.random()}`;
            const mv3Id = `mv3-${uniqueId}`;
            
            const extension: Extension = {
                id: uniqueId,
                name: 'Resume Test Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Resume Test Extension',
                    version: '1.0.0',
                    manifest_version: 3,
                },
                files: [],
                mv3_extension_id: mv3Id,
            };

            await db.insertMigratedExtension(extension);
            testExtensions.push(extension);

            const result = await db.getMigratedExtensionIds();

            expect(result.sourceIds.has(uniqueId)).toBe(true);
            expect(result.mv3Ids.has(mv3Id)).toBe(true);
            expect(result.mv3ToSourceMap.get(mv3Id)).toBe(uniqueId);
        });

        it('should return mv3_extension_ids for migrated extensions', async () => {
            if (!db) return;

            const uniqueId = `resume-test-mv3-${Date.now()}-${Math.random()}`;
            const mv3Id = `mv3-output-${uniqueId}`;

            const extension: Extension = {
                id: uniqueId,
                name: 'MV3 ID Test Extension',
                manifest_v2_path: '/test/path/mv3',
                manifest: {
                    name: 'MV3 ID Test Extension',
                    version: '1.0.0',
                    manifest_version: 3,
                },
                files: [],
                mv3_extension_id: mv3Id,
            };

            await db.insertMigratedExtension(extension);
            testExtensions.push(extension);

            const result = await db.getMigratedExtensionIds();

            expect(result.mv3Ids.has(mv3Id)).toBe(true);
        });

        it('should provide correct mapping from mv3_extension_id to source id', async () => {
            if (!db) return;

            const sourceId = `source-mapping-${Date.now()}-${Math.random()}`;
            const mv3Id = `mv3-mapping-${sourceId}`;

            const extension: Extension = {
                id: sourceId,
                name: 'Mapping Test Extension',
                manifest_v2_path: '/test/mapping',
                manifest: {
                    name: 'Mapping Test Extension',
                    version: '1.0.0',
                    manifest_version: 3,
                },
                files: [],
                mv3_extension_id: mv3Id,
            };

            await db.insertMigratedExtension(extension);
            testExtensions.push(extension);

            const result = await db.getMigratedExtensionIds();

            // Verify the mapping works correctly
            const mappedSourceId = result.mv3ToSourceMap.get(mv3Id);
            expect(mappedSourceId).toBe(sourceId);
        });

        it('should handle multiple migrated extensions', async () => {
            if (!db) return;

            const extensions: Extension[] = [];
            const count = 5;

            for (let i = 0; i < count; i++) {
                const sourceId = `multi-source-${Date.now()}-${i}-${Math.random()}`;
                const mv3Id = `multi-mv3-${Date.now()}-${i}`;
                
                extensions.push({
                    id: sourceId,
                    name: `Multi Test Extension ${i}`,
                    manifest_v2_path: `/test/multi/${i}`,
                    manifest: {
                        name: `Multi Test Extension ${i}`,
                        version: '1.0.0',
                        manifest_version: 3,
                    },
                    files: [],
                    mv3_extension_id: mv3Id,
                });
            }

            // Insert all extensions
            for (const ext of extensions) {
                await db.insertMigratedExtension(ext);
                testExtensions.push(ext);
            }

            const result = await db.getMigratedExtensionIds();

            // Verify all extensions are in the result
            for (const ext of extensions) {
                expect(result.sourceIds.has(ext.id)).toBe(true);
                expect(result.mv3Ids.has(ext.mv3_extension_id!)).toBe(true);
            }
        });

        it('should not include extensions without mv3_extension_id', async () => {
            if (!db) return;

            const sourceId = `no-mv3-${Date.now()}-${Math.random()}`;

            const extension: Extension = {
                id: sourceId,
                name: 'No MV3 ID Extension',
                manifest_v2_path: '/test/no-mv3',
                manifest: {
                    name: 'No MV3 ID Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
                // Note: no mv3_extension_id
            };

            await db.insertFoundExtensions([extension]);
            testExtensions.push(extension);

            const result = await db.getMigratedExtensionIds();

            // This extension should NOT be in the migrated list
            expect(result.sourceIds.has(sourceId)).toBe(false);
        });
    });

    describe('Disk Scanning: getAlreadyMigratedFromDisk', () => {
        // We test the disk scanning logic by directly testing the helper functions
        // without instantiating the full MigrationServer (which binds to port 8080)

        beforeEach(() => {
            // Create a temporary directory for testing
            tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extporter-resume-test-'));
        });

        afterEach(() => {
            // Clean up temporary directory
            if (tempOutputDir && fs.existsSync(tempOutputDir)) {
                fs.rmSync(tempOutputDir, { recursive: true, force: true });
            }
        });

        // Helper function to check if a directory is a valid migrated extension
        const isValidMigratedExtension = (dirPath: string): boolean => {
            try {
                const manifestPath = path.join(dirPath, 'manifest.json');
                return fs.existsSync(manifestPath);
            } catch {
                return false;
            }
        };

        // Helper function to scan disk for migrated extensions
        const getAlreadyMigratedFromDisk = (outputDir: string): Set<string> => {
            const migratedIds = new Set<string>();
            
            try {
                if (!fs.existsSync(outputDir)) {
                    return migratedIds;
                }

                const entries = fs.readdirSync(outputDir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    
                    const dirPath = path.join(outputDir, entry.name);
                    
                    if (entry.name === 'new_tab_extensions') {
                        const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
                        for (const subEntry of subEntries) {
                            if (subEntry.isDirectory()) {
                                const subDirPath = path.join(dirPath, subEntry.name);
                                if (isValidMigratedExtension(subDirPath)) {
                                    migratedIds.add(subEntry.name);
                                }
                            }
                        }
                    } else {
                        if (isValidMigratedExtension(dirPath)) {
                            migratedIds.add(entry.name);
                        }
                    }
                }
            } catch (error) {
                console.error('Error scanning output directory:', error);
            }
            
            return migratedIds;
        };

        it('should return empty set for non-existent directory', () => {
            const nonExistentDir = path.join(os.tmpdir(), 'non-existent-dir-' + Date.now());
            
            const result = getAlreadyMigratedFromDisk(nonExistentDir);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        it('should return empty set for empty directory', () => {
            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result).toBeInstanceOf(Set);
            expect(result.size).toBe(0);
        });

        it('should detect migrated extension with manifest.json', () => {
            // Create a fake migrated extension folder
            const extensionId = 'test-extension-abc123';
            const extensionDir = path.join(tempOutputDir, extensionId);
            fs.mkdirSync(extensionDir, { recursive: true });
            
            // Create manifest.json
            fs.writeFileSync(
                path.join(extensionDir, 'manifest.json'),
                JSON.stringify({ name: 'Test', manifest_version: 3 })
            );

            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result.has(extensionId)).toBe(true);
        });

        it('should ignore folders without manifest.json', () => {
            // Create a folder without manifest.json
            const folderId = 'incomplete-extension';
            const folderDir = path.join(tempOutputDir, folderId);
            fs.mkdirSync(folderDir, { recursive: true });
            
            // Create some other file, but not manifest.json
            fs.writeFileSync(path.join(folderDir, 'background.js'), 'console.log("test")');

            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result.has(folderId)).toBe(false);
        });

        it('should handle new_tab_extensions subfolder', () => {
            // Create new_tab_extensions subfolder
            const newTabDir = path.join(tempOutputDir, 'new_tab_extensions');
            fs.mkdirSync(newTabDir, { recursive: true });

            // Create a new tab extension
            const extensionId = 'new-tab-ext-123';
            const extensionDir = path.join(newTabDir, extensionId);
            fs.mkdirSync(extensionDir, { recursive: true });
            fs.writeFileSync(
                path.join(extensionDir, 'manifest.json'),
                JSON.stringify({ name: 'New Tab Extension', manifest_version: 3 })
            );

            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result.has(extensionId)).toBe(true);
        });

        it('should detect multiple migrated extensions', () => {
            const extensionIds = ['ext-1', 'ext-2', 'ext-3'];

            for (const id of extensionIds) {
                const dir = path.join(tempOutputDir, id);
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(
                    path.join(dir, 'manifest.json'),
                    JSON.stringify({ name: `Extension ${id}`, manifest_version: 3 })
                );
            }

            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result.size).toBe(3);
            for (const id of extensionIds) {
                expect(result.has(id)).toBe(true);
            }
        });

        it('should handle mixed valid and invalid extension folders', () => {
            // Create valid extension
            const validId = 'valid-extension';
            const validDir = path.join(tempOutputDir, validId);
            fs.mkdirSync(validDir, { recursive: true });
            fs.writeFileSync(
                path.join(validDir, 'manifest.json'),
                JSON.stringify({ name: 'Valid', manifest_version: 3 })
            );

            // Create invalid extension (no manifest)
            const invalidId = 'invalid-extension';
            const invalidDir = path.join(tempOutputDir, invalidId);
            fs.mkdirSync(invalidDir, { recursive: true });
            fs.writeFileSync(path.join(invalidDir, 'other.txt'), 'not a manifest');

            // Create a file (not a directory)
            fs.writeFileSync(path.join(tempOutputDir, 'random-file.txt'), 'content');

            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result.has(validId)).toBe(true);
            expect(result.has(invalidId)).toBe(false);
            expect(result.has('random-file.txt')).toBe(false);
        });

        it('should handle both regular and new_tab extensions together', () => {
            // Regular extension
            const regularId = 'regular-ext';
            const regularDir = path.join(tempOutputDir, regularId);
            fs.mkdirSync(regularDir, { recursive: true });
            fs.writeFileSync(
                path.join(regularDir, 'manifest.json'),
                JSON.stringify({ name: 'Regular', manifest_version: 3 })
            );

            // New tab extension
            const newTabDir = path.join(tempOutputDir, 'new_tab_extensions');
            fs.mkdirSync(newTabDir, { recursive: true });
            const newTabId = 'new-tab-ext';
            const newTabExtDir = path.join(newTabDir, newTabId);
            fs.mkdirSync(newTabExtDir, { recursive: true });
            fs.writeFileSync(
                path.join(newTabExtDir, 'manifest.json'),
                JSON.stringify({ name: 'New Tab', manifest_version: 3 })
            );

            const result = getAlreadyMigratedFromDisk(tempOutputDir);

            expect(result.size).toBe(2);
            expect(result.has(regularId)).toBe(true);
            expect(result.has(newTabId)).toBe(true);
        });
    });

    describe('isValidMigratedExtension', () => {
        beforeEach(() => {
            tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extporter-valid-test-'));
        });

        afterEach(() => {
            if (tempOutputDir && fs.existsSync(tempOutputDir)) {
                fs.rmSync(tempOutputDir, { recursive: true, force: true });
            }
        });

        const isValidMigratedExtension = (dirPath: string): boolean => {
            try {
                const manifestPath = path.join(dirPath, 'manifest.json');
                return fs.existsSync(manifestPath);
            } catch {
                return false;
            }
        };

        it('should return true for directory with manifest.json', () => {
            const extensionDir = path.join(tempOutputDir, 'valid-ext');
            fs.mkdirSync(extensionDir, { recursive: true });
            fs.writeFileSync(
                path.join(extensionDir, 'manifest.json'),
                JSON.stringify({ name: 'Valid' })
            );

            const result = isValidMigratedExtension(extensionDir);
            expect(result).toBe(true);
        });

        it('should return false for directory without manifest.json', () => {
            const extensionDir = path.join(tempOutputDir, 'invalid-ext');
            fs.mkdirSync(extensionDir, { recursive: true });

            const result = isValidMigratedExtension(extensionDir);
            expect(result).toBe(false);
        });

        it('should return false for non-existent directory', () => {
            const nonExistentDir = path.join(tempOutputDir, 'non-existent');

            const result = isValidMigratedExtension(nonExistentDir);
            expect(result).toBe(false);
        });

        it('should handle directory with empty manifest.json', () => {
            const extensionDir = path.join(tempOutputDir, 'empty-manifest-ext');
            fs.mkdirSync(extensionDir, { recursive: true });
            fs.writeFileSync(path.join(extensionDir, 'manifest.json'), '');

            // Should still return true because manifest.json exists
            const result = isValidMigratedExtension(extensionDir);
            expect(result).toBe(true);
        });
    });

    describe('Resume Logic Integration', () => {
        beforeEach(() => {
            tempOutputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extporter-integration-'));
        });

        afterEach(() => {
            if (tempOutputDir && fs.existsSync(tempOutputDir)) {
                fs.rmSync(tempOutputDir, { recursive: true, force: true });
            }
        });

        // Helper functions (same as the ones used in the server)
        const isValidMigratedExtension = (dirPath: string): boolean => {
            try {
                const manifestPath = path.join(dirPath, 'manifest.json');
                return fs.existsSync(manifestPath);
            } catch {
                return false;
            }
        };

        const getAlreadyMigratedFromDisk = (outputDir: string): Set<string> => {
            const migratedIds = new Set<string>();
            
            try {
                if (!fs.existsSync(outputDir)) {
                    return migratedIds;
                }

                const entries = fs.readdirSync(outputDir, { withFileTypes: true });
                
                for (const entry of entries) {
                    if (!entry.isDirectory()) continue;
                    
                    const dirPath = path.join(outputDir, entry.name);
                    
                    if (entry.name === 'new_tab_extensions') {
                        const subEntries = fs.readdirSync(dirPath, { withFileTypes: true });
                        for (const subEntry of subEntries) {
                            if (subEntry.isDirectory()) {
                                const subDirPath = path.join(dirPath, subEntry.name);
                                if (isValidMigratedExtension(subDirPath)) {
                                    migratedIds.add(subEntry.name);
                                }
                            }
                        }
                    } else {
                        if (isValidMigratedExtension(dirPath)) {
                            migratedIds.add(entry.name);
                        }
                    }
                }
            } catch (error) {
                console.error('Error scanning output directory:', error);
            }
            
            return migratedIds;
        };

        it('should combine database and disk IDs correctly', async () => {
            if (!db) {
                console.warn('Skipping integration test - DB not available');
                return;
            }

            // Setup: Create some extensions in the database
            const dbExtId = `db-only-${Date.now()}-${Math.random()}`;
            const dbMv3Id = `mv3-db-only-${dbExtId}`;
            
            await db.insertMigratedExtension({
                id: dbExtId,
                name: 'DB Only Extension',
                manifest_v2_path: '/test/db-only',
                manifest: { name: 'DB Only', manifest_version: 3 },
                files: [],
                mv3_extension_id: dbMv3Id,
            });

            // Setup: Create some extensions only on disk
            const diskOnlyId = 'disk-only-extension';
            const diskDir = path.join(tempOutputDir, diskOnlyId);
            fs.mkdirSync(diskDir, { recursive: true });
            fs.writeFileSync(
                path.join(diskDir, 'manifest.json'),
                JSON.stringify({ name: 'Disk Only', manifest_version: 3 })
            );

            // Get IDs from both sources
            const dbMigrated = await db.getMigratedExtensionIds();
            const diskIds = getAlreadyMigratedFromDisk(tempOutputDir);

            // Combine them (as the handleStartCommand does)
            const alreadyMigratedIds = new Set<string>([...dbMigrated.sourceIds]);
            for (const mv3Id of diskIds) {
                const sourceId = dbMigrated.mv3ToSourceMap.get(mv3Id);
                if (sourceId) {
                    alreadyMigratedIds.add(sourceId);
                } else {
                    alreadyMigratedIds.add(mv3Id);
                }
            }

            // Verify: DB extension should be in the combined set (by source ID)
            expect(alreadyMigratedIds.has(dbExtId)).toBe(true);

            // Verify: Disk-only extension should be in the combined set (by folder name)
            expect(alreadyMigratedIds.has(diskOnlyId)).toBe(true);
        });

        it('should handle mv3_extension_id mapping from disk to source', async () => {
            if (!db) {
                console.warn('Skipping integration test - DB not available');
                return;
            }

            // Setup: Create an extension in DB with a mapping
            const sourceId = `source-${Date.now()}-${Math.random()}`;
            const mv3Id = `mv3-folder-${Date.now()}`;

            await db.insertMigratedExtension({
                id: sourceId,
                name: 'Mapped Extension',
                manifest_v2_path: '/test/mapped',
                manifest: { name: 'Mapped', manifest_version: 3 },
                files: [],
                mv3_extension_id: mv3Id,
            });

            // Setup: Create a folder on disk with the mv3_extension_id as the name
            const mv3Dir = path.join(tempOutputDir, mv3Id);
            fs.mkdirSync(mv3Dir, { recursive: true });
            fs.writeFileSync(
                path.join(mv3Dir, 'manifest.json'),
                JSON.stringify({ name: 'Mapped', manifest_version: 3 })
            );

            // Get IDs
            const dbMigrated = await db.getMigratedExtensionIds();
            const diskIds = getAlreadyMigratedFromDisk(tempOutputDir);

            // Build combined set
            const alreadyMigratedIds = new Set<string>([...dbMigrated.sourceIds]);
            for (const diskMv3Id of diskIds) {
                const mappedSourceId = dbMigrated.mv3ToSourceMap.get(diskMv3Id);
                if (mappedSourceId) {
                    alreadyMigratedIds.add(mappedSourceId);
                } else {
                    alreadyMigratedIds.add(diskMv3Id);
                }
            }

            // The source ID should be in the combined set, mapped from the disk mv3Id
            expect(alreadyMigratedIds.has(sourceId)).toBe(true);
        });

        it('should correctly identify extensions to skip during migration', async () => {
            if (!db) {
                console.warn('Skipping integration test - DB not available');
                return;
            }

            // Simulate having previously migrated some extensions
            const previouslyMigratedIds = [
                `prev-1-${Date.now()}`,
                `prev-2-${Date.now()}`,
                `prev-3-${Date.now()}`,
            ];

            for (const id of previouslyMigratedIds) {
                await db.insertMigratedExtension({
                    id,
                    name: `Previously Migrated ${id}`,
                    manifest_v2_path: `/test/prev/${id}`,
                    manifest: { name: `Prev ${id}`, manifest_version: 3 },
                    files: [],
                    mv3_extension_id: `mv3-${id}`,
                });
            }

            // Get the set of already migrated IDs
            const dbMigrated = await db.getMigratedExtensionIds();

            // Simulate new extensions to be processed
            const newExtensionIds = [
                previouslyMigratedIds[0], // This should be skipped
                `new-1-${Date.now()}`,    // This should be migrated
                previouslyMigratedIds[2], // This should be skipped
                `new-2-${Date.now()}`,    // This should be migrated
            ];

            let skippedCount = 0;
            let migratedCount = 0;

            for (const id of newExtensionIds) {
                if (dbMigrated.sourceIds.has(id)) {
                    skippedCount++;
                } else {
                    migratedCount++;
                }
            }

            expect(skippedCount).toBe(2);
            expect(migratedCount).toBe(2);
        });
    });
});
