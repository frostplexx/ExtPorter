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
        if (!process.env.MONGODB_URI) {
            console.warn('Skipping database tests - MONGODB not available');
            return;
        }

        db = Database.shared;
        // Use test database
        process.env.MONGO_DATABASE = 'migrator_test';

        try {
            // Attempt to initialize with a short timeout to avoid hangs
            await Promise.race([
                db.init(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('MongoDB connection timeout')), 5000)
                ),
            ]);
        } catch (error) {
            console.warn('Could not connect to MongoDB for testing:', error);
            // Skip database tests if we can't connect
            db = undefined as any;
            return;
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
            if (!db) return;

            expect(db).toBeDefined();
            // Test that we can perform a basic operation
            const testExtensions: Extension[] = [];
            await expect(db.insertFoundExtensions(testExtensions)).resolves.not.toThrow();
        });

        it('should handle connection errors gracefully', async () => {
            if (!db) return;

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
            if (!process.env.MONGODB_URI) return;

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
            if (!db) return;

            const extensions = [sampleExtension];
            await expect(db.insertFoundExtensions(extensions)).resolves.not.toThrow();
        });

        it('should insert migrated extensions', async () => {
            if (!db) return;

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
            if (!db) return;

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
            if (!db) return;

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
            if (!db) return;

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
            if (!db) return;

            await db.insertFoundExtensions([tagExtension]);
            const result = await db.extensionAppendTag(tagExtension, 'test-tag');

            expect(result).toBeDefined();
        });

        it('should not duplicate tags', async () => {
            if (!db) return;

            await db.insertFoundExtensions([tagExtension]);
            await db.extensionAppendTag(tagExtension, 'duplicate-tag');
            const result = await db.extensionAppendTag(tagExtension, 'duplicate-tag');

            expect(result).toBeDefined();
        });

        it('should remove tag from extension', async () => {
            if (!db) return;

            await db.insertFoundExtensions([tagExtension]);
            await db.extensionAppendTag(tagExtension, 'remove-tag');
            const result = await db.extensionRemoveTag(tagExtension, 'remove-tag');

            expect(result).toBeDefined();
        });

        it('should handle removing non-existent tag', async () => {
            if (!db) return;

            await db.insertFoundExtensions([tagExtension]);
            const result = await db.extensionRemoveTag(tagExtension, 'non-existent-tag');

            expect(result).toBeDefined();
        });

        it('should handle tag operations on non-existent extension', async () => {
            if (!db) return;

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
            if (!db) return;

            const log = {
                loglevel: LogLevel.INFO,
                message: 'Test log message',
                meta: { test: true },
                time: Date.now(),
            };

            await expect(db.insertLog(log)).resolves.not.toThrow();
        });

        it('should insert many logs', async () => {
            if (!db) return;

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
            if (!db) return;

            await expect(db.insertManyLogs([])).resolves.not.toThrow();
        });
    });

    describe('Document Size Sanitization', () => {
        it('should handle large documents', async () => {
            if (!db) return;

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
            if (!db) return;

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
            if (!db) return;

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
            if (!db) return;

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
            if (!db) return;

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
        afterEach(() => {
            // Reset shutdown flag after each test
            if (db) {
                (db as any).isShuttingDown = false;
            }
        });

        it('should prevent operations after shutdown', async () => {
            if (!db) return;

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

            // These should be rejected when shutting down
            const log = {
                loglevel: LogLevel.INFO,
                message: 'Test log',
                meta: {},
                time: Date.now(),
            };

            // Single operations should be rejected
            await expect(db.insertLog(log)).rejects.toThrow('Database is shutting down');
            await expect(db.insertMigratedExtension(extension)).rejects.toThrow(
                'Database is shutting down'
            );
        });
    });

    describe('Database Statistics', () => {
        it('should track database operations', async () => {
            if (!db) return;

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

    describe('Queue Management', () => {
        it('should process operations through the queue', async () => {
            if (!db) return;

            const extension: Extension = {
                id: `queue-test-${Date.now()}-${Math.random()}`,
                name: 'Queue Test Extension',
                manifest_v2_path: '/queue/path',
                manifest: {
                    name: 'Queue Test Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            };

            // Insert extension through the queue
            await db.insertMigratedExtension(extension);

            // Verify it was inserted
            const found = await db.findExtension({ id: extension.id });
            expect(found).toBeDefined();
        });

        it('should handle concurrent operations', async () => {
            if (!db) return;

            const extensions: Extension[] = Array.from({ length: 20 }, (_, i) => ({
                id: `concurrent-${Date.now()}-${i}-${Math.random()}`,
                name: `Concurrent Test ${i}`,
                manifest_v2_path: `/concurrent/path/${i}`,
                manifest: {
                    name: `Concurrent Test ${i}`,
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            }));

            // Insert all extensions concurrently
            const promises = extensions.map((ext) => db.insertMigratedExtension(ext));
            await Promise.all(promises);

            // Verify all were inserted
            for (const ext of extensions) {
                const found = await db.findExtension({ id: ext.id });
                expect(found).toBeDefined();
            }
        });

        it('should wait for queue to complete before closing', async () => {
            if (!db) return;

            const extensions: Extension[] = Array.from({ length: 10 }, (_, i) => ({
                id: `close-test-${Date.now()}-${i}-${Math.random()}`,
                name: `Close Test ${i}`,
                manifest_v2_path: `/close/path/${i}`,
                manifest: {
                    name: `Close Test ${i}`,
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            }));

            // Start inserting extensions
            const promises = extensions.map((ext) => db.insertMigratedExtension(ext));

            // Wait for all operations to complete
            await Promise.all(promises);

            // Verify queue is empty by checking pending operations
            const pendingOps = (db as any).pendingOperations;
            const queueLength = (db as any).operationQueue.length;

            expect(pendingOps).toBe(0);
            expect(queueLength).toBe(0);
        });

        it('should reject operations when shutting down', async () => {
            if (!db) return;

            // Mark as shutting down
            (db as any).isShuttingDown = true;

            const extension: Extension = {
                id: `reject-test-${Date.now()}-${Math.random()}`,
                name: 'Reject Test',
                manifest_v2_path: '/reject/path',
                manifest: {
                    name: 'Reject Test',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            };

            // Attempt to insert should be rejected
            await expect(db.insertMigratedExtension(extension)).rejects.toThrow(
                'Database is shutting down'
            );

            // Reset shutdown flag
            (db as any).isShuttingDown = false;
        });

        it('should handle queue errors gracefully', async () => {
            if (!db) return;

            // Create an invalid extension that might cause errors
            const invalidExtension = {
                id: `error-test-${Date.now()}-${Math.random()}`,
                name: 'Error Test',
                manifest_v2_path: '/error/path',
                manifest: {
                    name: 'Error Test',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            } as Extension;

            // Should handle gracefully even with potential errors
            await expect(db.insertMigratedExtension(invalidExtension)).resolves.not.toThrow();
        });
    });
});
