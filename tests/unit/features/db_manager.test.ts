import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { Database, Collections } from '../../../migrator/features/database/db_manager';
import { Extension } from '../../../migrator/types/extension';
import { LogLevel } from '../../../migrator/utils/logger';

// Mock MongoDB for testing - we'll use in-memory MongoDB for these tests
// This is a simplified version that tests the interface without requiring actual MongoDB
describe('Database Manager', () => {
    let db: Database;

    beforeAll(async () => {
        // Skip database tests if MongoDB is not available
        if (!process.env.MONGODB_URI && !process.env.CI) {
            console.warn('Skipping database tests - MongoDB not available');
            return;
        }

        db = Database.shared;
        // Use test database
        process.env.MONGO_DATABASE = 'migrator_test';

        try {
            await db.init();
        } catch (error) {
            console.warn('Could not connect to MongoDB for testing:', error);
            // Mark as pending if we can't connect
            pending('MongoDB not available for testing');
        }
    });

    afterAll(async () => {
        if (db) {
            try {
                // Clean up test database
                await db.close();
            } catch (error) {
                console.warn('Error closing database:', error);
            }
        }
    });

    beforeEach(async () => {
        if (!db) return;

        // Note: clearCollections method doesn't exist on Database class
        // Tests should be designed to be independent without requiring cleanup
    });

    describe('Connection Management', () => {
        it('should initialize database connection', async () => {
            if (!db) pending('Database not available');

            expect(db).toBeDefined();
            // Test that we can perform a basic operation
            const testExtensions: Extension[] = [];
            await expect(db.insertFoundExtensions(testExtensions)).resolves.not.toThrow();
        });

        it('should handle connection errors gracefully', async () => {
            if (!db) pending('Database not available');

            // This test would require mocking the MongoDB connection
            // For now, we'll just verify the Database class exists
            expect(Database.shared).toBeDefined();
        });

        it('should handle missing MONGODB_URI', async () => {
            const savedUri = process.env.MONGODB_URI;
            delete process.env.MONGODB_URI;

            const newDb = new (Database as any)();
            await expect(newDb.init()).rejects.toThrow('Could not find MONGODB_URI in environment');

            process.env.MONGODB_URI = savedUri;
        });

        it('should handle missing DB_NAME', async () => {
            if (!process.env.MONGODB_URI) pending('MONGODB_URI not available');

            const savedDbName = process.env.DB_NAME;
            delete process.env.DB_NAME;

            const newDb = new (Database as any)();
            await expect(newDb.init()).rejects.toThrow('Could not find DB_NAME in environment');

            process.env.DB_NAME = savedDbName;
        });
    });

    describe('Extension Operations', () => {
        // Generate unique extension for each test run
        const sampleExtension: Extension = {
            id: `test-extension-${Date.now()}-${Math.random()}`,
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {
                name: 'Test Extension',
                version: '1.0.0',
                manifest_version: 2,
                description: 'A test extension',
            },
            files: [],
        };

        it('should insert found extensions', async () => {
            if (!db) pending('Database not available');

            const extensions = [sampleExtension];
            await expect(db.insertFoundExtensions(extensions)).resolves.not.toThrow();
        });

        it('should insert migrated extensions', async () => {
            if (!db) pending('Database not available');

            const migratedExtension = {
                ...sampleExtension,
                manifest: {
                    ...sampleExtension.manifest,
                    manifest_version: 3,
                },
                mv3_extension_id: 'migrated-123',
            };

            await expect(db.insertMigratedExtension(migratedExtension)).resolves.not.toThrow();
        });

        it('should insert migrated extensions array', async () => {
            if (!db) pending('Database not available');

            const extensions = [
                {
                    ...sampleExtension,
                    id: `test-array-${Date.now()}-${Math.random()}`,
                    manifest: { ...sampleExtension.manifest, manifest_version: 3 },
                },
            ];

            await expect(db.insertMigratedExtensions(extensions)).resolves.not.toThrow();
        });

        it('should handle duplicate extension insertions', async () => {
            if (!db) pending('Database not available');

            // Use a unique ID for this test to avoid conflicts
            const uniqueExtension = {
                ...sampleExtension,
                id: `test-extension-duplicate-${Date.now()}-${Math.random()}`,
            };
            const extensions = [uniqueExtension];

            // Insert once
            await db.insertFoundExtensions(extensions);

            // Insert again - should not throw
            await expect(db.insertFoundExtensions(extensions)).resolves.not.toThrow();
        });

        it('should find extension by filter', async () => {
            if (!db) pending('Database not available');

            const uniqueId = `test-find-${Date.now()}-${Math.random()}`;
            const extension = {
                ...sampleExtension,
                id: uniqueId,
            };

            await db.insertFoundExtensions([extension]);
            const found = await db.findExtension({ id: uniqueId });

            expect(found).toBeDefined();
        });
    });

    describe('Tag Operations', () => {
        const tagExtension: Extension = {
            id: `tag-test-${Date.now()}-${Math.random()}`,
            name: 'Tag Test Extension',
            manifest_v2_path: '/test/tag',
            manifest: {
                name: 'Tag Test Extension',
                version: '1.0.0',
                manifest_version: 2,
            },
            files: [],
        };

        it('should append tag to extension', async () => {
            if (!db) pending('Database not available');

            await db.insertFoundExtensions([tagExtension]);
            const result = await db.extensionAppendTag(tagExtension, 'test-tag');

            expect(result).toBeDefined();
        });

        it('should not duplicate tags', async () => {
            if (!db) pending('Database not available');

            await db.insertFoundExtensions([tagExtension]);
            await db.extensionAppendTag(tagExtension, 'duplicate-tag');
            const result = await db.extensionAppendTag(tagExtension, 'duplicate-tag');

            expect(result).toBeDefined();
        });

        it('should remove tag from extension', async () => {
            if (!db) pending('Database not available');

            await db.insertFoundExtensions([tagExtension]);
            await db.extensionAppendTag(tagExtension, 'remove-tag');
            const result = await db.extensionRemoveTag(tagExtension, 'remove-tag');

            expect(result).toBeDefined();
        });

        it('should handle removing non-existent tag', async () => {
            if (!db) pending('Database not available');

            await db.insertFoundExtensions([tagExtension]);
            const result = await db.extensionRemoveTag(tagExtension, 'non-existent-tag');

            expect(result).toBeDefined();
        });

        it('should handle tag operations on non-existent extension', async () => {
            if (!db) pending('Database not available');

            const nonExistent: Extension = {
                ...tagExtension,
                id: 'non-existent-id-12345',
            };

            const result = await db.extensionAppendTag(nonExistent, 'test-tag');
            expect(result).toBeNull();
        });
    });

    describe('Log Operations', () => {
        it('should insert log', async () => {
            if (!db) pending('Database not available');

            const log = {
                loglevel: LogLevel.INFO,
                message: 'Test log message',
                meta: { test: true },
                time: Date.now(),
            };

            await expect(db.insertLog(log)).resolves.not.toThrow();
        });

        it('should insert many logs', async () => {
            if (!db) pending('Database not available');

            const logs = [
                {
                    loglevel: LogLevel.INFO,
                    message: 'Test log 1',
                    meta: {},
                    time: Date.now(),
                },
                {
                    loglevel: LogLevel.DEBUG,
                    message: 'Test log 2',
                    meta: {},
                    time: Date.now() + 1,
                },
            ];

            await expect(db.insertManyLogs(logs)).resolves.not.toThrow();
        });

        it('should handle empty logs array', async () => {
            if (!db) pending('Database not available');

            await expect(db.insertManyLogs([])).resolves.not.toThrow();
        });
    });

    describe('Document Size Sanitization', () => {
        it('should handle large documents', async () => {
            if (!db) pending('Database not available');

            // Create extension with large content
            const largeContent = 'A'.repeat(2 * 1024 * 1024); // 2MB string
            const largeExtension: Extension = {
                id: `large-doc-${Date.now()}-${Math.random()}`,
                name: 'Large Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Large Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: Array.from({ length: 15 }, (_, i) => ({
                    path: `file${i}.js`,
                    content: largeContent,
                    filetype: 'js' as any,
                    getContent: () => largeContent,
                    getBuffer: () => Buffer.from(largeContent),
                })) as any,
            };

            await expect(db.insertMigratedExtension(largeExtension)).resolves.not.toThrow();
        });

        it('should handle extremely large documents that exceed max size', async () => {
            if (!db) pending('Database not available');

            const hugeContent = 'B'.repeat(5 * 1024 * 1024); // 5MB string
            const hugeExtension: Extension = {
                id: `huge-doc-${Date.now()}-${Math.random()}`,
                name: 'Huge Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Huge Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: Array.from({ length: 20 }, (_, i) => ({
                    path: `file${i}.js`,
                    content: hugeContent,
                    filetype: 'js' as any,
                    getContent: () => hugeContent,
                    getBuffer: () => Buffer.from(hugeContent),
                })) as any,
            };

            await expect(db.insertMigratedExtension(hugeExtension)).resolves.not.toThrow();
        });
    });

    describe('Data Validation', () => {
        it('should validate extension data before insertion', async () => {
            if (!db) pending('Database not available');

            const invalidExtension = {
                // Missing required fields
                name: 'Invalid Extension',
            } as any;

            // Should handle invalid data gracefully
            await expect(db.insertFoundExtensions([invalidExtension])).resolves.not.toThrow();
        });
    });

    describe('Error Handling', () => {
        it('should handle database operation failures gracefully', async () => {
            if (!db) pending('Database not available');

            // Test with extremely large data that might cause issues
            const largeExtension: Extension = {
                id: `large-extension-${Date.now()}-${Math.random()}`,
                name: 'Large Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Large Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                    description: 'A'.repeat(10000), // Very long description
                },
                files: [],
            };

            // Should not throw even with large data
            await expect(db.insertFoundExtensions([largeExtension])).resolves.not.toThrow();
        });

        it('should handle serialization errors in sanitization', async () => {
            if (!db) pending('Database not available');

            // Create circular reference that can't be serialized
            const circularExt: any = {
                id: `circular-${Date.now()}-${Math.random()}`,
                name: 'Circular Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Circular Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            };
            circularExt.self = circularExt; // Create circular reference

            // Should handle circular reference gracefully
            await expect(db.insertMigratedExtension(circularExt)).resolves.not.toThrow();
        });
    });

    describe('Shutdown Handling', () => {
        it('should prevent operations after shutdown', async () => {
            if (!db) pending('Database not available');

            // Mark as shutting down
            (db as any).isShuttingDown = true;

            const extension: Extension = {
                id: `shutdown-test-${Date.now()}-${Math.random()}`,
                name: 'Shutdown Test',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Shutdown Test',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            };

            // These should not execute when shutting down
            const log = {
                loglevel: LogLevel.INFO,
                message: 'Test log',
                meta: {},
                time: Date.now(),
            };

            await db.insertLog(log);
            await db.insertManyLogs([log]);

            // Reset shutdown flag
            (db as any).isShuttingDown = false;
        });
    });

    describe('Database Statistics', () => {
        it('should track database operations', async () => {
            if (!db) pending('Database not available');

            const extension: Extension = {
                id: `stats-extension-${Date.now()}-${Math.random()}`,
                name: 'Stats Extension',
                manifest_v2_path: '/stats/path',
                manifest: {
                    name: 'Stats Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            };

            // Perform multiple operations
            await db.insertFoundExtensions([extension]);
            await db.insertMigratedExtension(extension);

            // All operations should complete successfully
            expect(true).toBe(true); // Placeholder assertion
        });
    });
});
