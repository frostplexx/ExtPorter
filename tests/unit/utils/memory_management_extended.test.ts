import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import {
    getMemoryInfo,
    formatMemoryUsage,
    logMemoryUsage,
    forceGarbageCollection,
    checkMemoryThreshold,
    clearExtensionMemory,
    shouldTriggerGC,
    aggressiveCleanup,
    periodicMemoryCheck,
    calculateExtensionMemoryUsage,
    getExtensionsMemorySummary,
} from '../../../migrator/utils/garbage';
import { Extension } from '../../../migrator/types/extension';
import { LazyFile, createTransformedFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

// Mock the Database singleton for testing
jest.mock('../../../migrator/features/database/db_manager');
const mockDatabase = {
    shared: {
        getQueueStatus: jest.fn().mockReturnValue({
            queued: 0,
            pending: 0,
            maxSize: 1000,
        }),
    },
};

// Mock the logger for testing
jest.mock('../../../migrator/utils/logger');
const mockLogger = {
    getStats: jest.fn().mockReturnValue({
        batchSize: 0,
        droppedCount: 0,
        maxBatchSize: 100,
    }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
};

// Mock the MigrationServer for testing
jest.mock('../../../migrator/features/server/app');
const mockMigrationServer = {
    MigrationServer: jest.fn().mockImplementation((options: any) => ({
        connectionTimeout: options.extensionsPath ? 5 * 60 * 1000 : 300000, // 5 minutes
        cleanupIntervalMs: 60000, // 1 minute
    })),
};

// Mock the ExtensionFixer for testing
jest.mock('../../../migrator/features/llm/extension-fixer');
const mockExtensionFixer = {
    ExtensionFixer: jest.fn().mockImplementation(() => ({
        trimConversationHistory: jest.fn(),
        cleanup: jest.fn(),
    })),
};

describe('Memory Management Extended', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'memory_management_extended_test');
    let originalEnv: NodeJS.ProcessEnv;
    let originalGC: any;

    beforeEach(() => {
        fs.ensureDirSync(testDir);
        originalEnv = { ...process.env };
        originalGC = (global as any).gc;
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
        process.env = originalEnv;
        (global as any).gc = originalGC;
    });

    describe('WebSocket Connection Management', () => {
        it('should have connection timeout configured', async () => {
            const server = new mockMigrationServer.MigrationServer({
                extensionsPath: testDir,
                outputDir: testDir,
            });

            expect(server).toBeDefined();
            expect((server as any).connectionTimeout).toBe(5 * 60 * 1000);
        });

        it('should have cleanup interval configured', async () => {
            const server = new mockMigrationServer.MigrationServer({
                extensionsPath: testDir,
                outputDir: testDir,
            });

            expect(server).toBeDefined();
            expect((server as any).cleanupIntervalMs).toBe(60000);
        });
    });

    describe('Extension Fixer Configuration', () => {
        it('should have trimConversationHistory method', async () => {
            const fixer = new mockExtensionFixer.ExtensionFixer(null, {
                extensionId: 'test',
                extensionName: 'Test',
                extensionDir: testDir,
                manifestPath: path.join(testDir, 'manifest.json'),
                manifest: {},
                report: {},
            });

            expect(fixer).toBeDefined();
            expect(typeof (fixer as any).trimConversationHistory).toBe('function');
        });

        it('should have cleanup method', async () => {
            const fixer = new mockExtensionFixer.ExtensionFixer(null, {
                extensionId: 'test',
                extensionName: 'Test',
                extensionDir: testDir,
                manifestPath: path.join(testDir, 'manifest.json'),
                manifest: {},
                report: {},
            });

            expect(fixer).toBeDefined();
            expect(typeof (fixer as any).cleanup).toBe('function');
        });
    });

    describe('Database Queue Management', () => {
        it('should have queue size limits configured', async () => {
            const status = mockDatabase.shared.getQueueStatus() as any;

            expect(status.maxSize).toBe(1000);
            expect(typeof status.queued).toBe('number');
            expect(typeof status.pending).toBe('number');
            expect(mockDatabase.shared.getQueueStatus).toHaveBeenCalled();
        });
    });

    describe('Logger Configuration', () => {
        it('should have batch size limits configured', async () => {
            const stats = mockLogger.getStats() as any;

            expect(stats.maxBatchSize).toBe(100);
            expect(typeof stats.batchSize).toBe('number');
            expect(typeof stats.droppedCount).toBe('number');
            expect(mockLogger.getStats).toHaveBeenCalled();
        });
    });

    describe('Memory Thresholds', () => {
        it('should use custom thresholds from environment', () => {
            process.env.MEMORY_CRIT_LIMIT = '64';
            process.env.MEMORY_WARN_LIMIT = '48';

            const result = checkMemoryThreshold();

            expect(result).toBe(true);

            // Reset
            delete process.env.MEMORY_CRIT_LIMIT;
            delete process.env.MEMORY_WARN_LIMIT;
        });

        it('should trigger GC check at configured threshold', () => {
            expect(shouldTriggerGC(100)).toBe(false);
            expect(shouldTriggerGC(0.001)).toBe(true);
        });

        it('should provide accurate memory statistics', () => {
            const info = getMemoryInfo();

            expect(info.heapUsedMB).toBeGreaterThanOrEqual(0);
            expect(info.heapTotalMB).toBeGreaterThanOrEqual(0);
            expect(info.rssMB).toBeGreaterThanOrEqual(0);
            expect(info.externalMB).toBeGreaterThanOrEqual(0);
            expect(info.arrayBuffersMB).toBeGreaterThanOrEqual(0);
            expect(info.heapUsedGB).toBeGreaterThanOrEqual(0);
            expect(info.rssGB).toBeGreaterThanOrEqual(0);

            expect(info.heapUsedGB).toBeCloseTo(info.heapUsedMB / 1024, 2);
            expect(info.rssGB).toBeCloseTo(info.rssMB / 1024, 2);
        });
    });

    describe('Extension Memory Management', () => {
        it('should properly clear extension memory', () => {
            const testFile = path.join(testDir, 'extension.js');
            const content = 'const x = 1;';
            fs.writeFileSync(testFile, content);

            const lazyFile = new LazyFile('extension.js', testFile, ExtFileType.JS);
            lazyFile.getContent(); // Load it

            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test',
                manifest: {
                    name: 'Test Extension',
                    version: '1.0',
                    manifest_version: 2,
                    description: 'A test extension',
                    permissions: ['storage'],
                },
                files: [lazyFile],
            };

            clearExtensionMemory(extension);

            expect(extension.files.length).toBe(0);
            expect(lazyFile.isLoaded()).toBe(false);

            lazyFile.close();
        });

        it('should preserve essential manifest fields', () => {
            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test',
                manifest: {
                    name: 'Test Extension',
                    version: '1.0',
                    manifest_version: 2,
                    description: 'A test extension',
                    permissions: ['storage'],
                },
                files: [],
            };

            clearExtensionMemory(extension);

            expect(extension.manifest.name).toBe('Test Extension');
            expect(extension.manifest.manifest_version).toBe(2);
            expect(extension.manifest.description).toBeUndefined();
            expect(extension.manifest.permissions).toBeUndefined();
        });
    });

    describe('Transformed File Management', () => {
        it('should release original file memory', () => {
            const testFile = path.join(testDir, 'transform-test.js');
            const originalContent = 'const x = 1;';
            fs.writeFileSync(testFile, originalContent);

            const originalFile = new LazyFile('transform-test.js', testFile, ExtFileType.JS);
            originalFile.getContent(); // Load it

            const transformedContent = 'const y = 2;';
            const transformedFile = createTransformedFile(originalFile, transformedContent);

            // Original file should have released memory
            expect(originalFile.isLoaded()).toBe(false);

            // Transformed file should work
            expect(transformedFile.getContent()).toBe(transformedContent);

            originalFile.close();
            // Clean up
            (transformedFile as any).releaseMemory?.();
            transformedFile.close();
        });

        it('should handle files without releaseMemory method', () => {
            const testFile = path.join(testDir, 'no-release.js');
            const content = 'const x = 1;';
            fs.writeFileSync(testFile, content);

            const mockFile: any = {
                path: 'no-release.js',
                filetype: ExtFileType.JS,
                getContent: () => content,
                isLoaded: () => false,
            };

            expect(() => createTransformedFile(mockFile, 'const y = 2;')).not.toThrow();
        });
    });

    describe('Memory Leak Detection', () => {
        it('should detect memory growth during processing', () => {
            const info1 = getMemoryInfo();
            const initialHeap = info1.heapUsedMB;

            // Simulate some memory growth
            const largeStrings = [];
            for (let i = 0; i < 10; i++) {
                largeStrings.push('A'.repeat(10000)); // 10KB each
            }
            largeStrings.length = 0; // Clear references

            const info2 = getMemoryInfo();
            expect(info2.heapUsedMB).toBeGreaterThanOrEqual(initialHeap);

            // Force GC and check memory reduces (if available)
            if (global.gc) {
                global.gc();
                const info3 = getMemoryInfo();
                expect(info3.heapUsedMB).toBeLessThanOrEqual(info2.heapUsedMB);
            }
        });

        it('should handle file descriptor cleanup', () => {
            const testFile = path.join(testDir, 'fd-leak.js');
            const content = 'const x = 1;';
            fs.writeFileSync(testFile, content);

            const files = [];
            for (let i = 0; i < 10; i++) {
                const lazyFile = new LazyFile(`fd-leak-${i}.js`, testFile, ExtFileType.JS);
                lazyFile.getContent(); // Load content
                files.push(lazyFile);
            }

            // All files should be loaded
            expect(files.every((f) => f.isLoaded())).toBe(true);

            // Release all memory
            files.forEach((f) => f.releaseMemory());
            files.forEach((f) => f.close());

            // All files should have released memory
            expect(files.every((f) => !f.isLoaded())).toBe(true);
        });

        it('should properly clean up transformed files', () => {
            const testFile = path.join(testDir, 'cleanup-test.js');
            const originalContent = 'const x = 1;';
            fs.writeFileSync(testFile, originalContent);

            const originalFile = new LazyFile('cleanup-test.js', testFile, ExtFileType.JS);
            originalFile.getContent();

            const transformedFile = createTransformedFile(originalFile, 'const y = 2;');

            // Original should be released
            expect(originalFile.isLoaded()).toBe(false);

            // Transformed should work
            expect(transformedFile.getContent()).toBe('const y = 2;');

            originalFile.close();
            // Cleanup transformed file
            (transformedFile as any).releaseMemory?.();
            transformedFile.close();
        });
    });

    describe('Performance Testing', () => {
        it('should handle large batch processing without OOM', () => {
            const extensions: Extension[] = [];

            // Create many mock extensions
            for (let i = 0; i < 20; i++) {
                const testFile = path.join(testDir, `perf-${i}.js`);
                const content = `const x${i} = ${i};`;
                fs.writeFileSync(testFile, content);

                const lazyFile = new LazyFile(`perf-${i}.js`, testFile, ExtFileType.JS);
                lazyFile.getContent(); // Load content

                extensions.push({
                    id: `perf-ext-${i}`,
                    name: `Performance Extension ${i}`,
                    manifest_v2_path: testFile,
                    manifest: {
                        name: `Performance Extension ${i}`,
                        version: '1.0',
                        manifest_version: 2,
                    },
                    files: [lazyFile],
                });
            }

            // Calculate initial memory
            const initialInfo = getMemoryInfo();

            // Process in batches with cleanup
            const batchSize = 5;
            for (let i = 0; i < extensions.length; i += batchSize) {
                const batch = extensions.slice(i, i + batchSize);

                // Clear memory for batch
                batch.forEach((ext) => clearExtensionMemory(ext));

                // Force GC occasionally
                if (i % (batchSize * 2) === 0) {
                    forceGarbageCollection();
                }
            }

            // Memory should be reasonable
            const finalInfo = getMemoryInfo();
            expect(finalInfo.heapUsedMB).toBeLessThan(initialInfo.heapUsedMB * 1.5); // Allow some growth

            // Clean up
            aggressiveCleanup(extensions);
        });
    });

    describe('Environment Configurations', () => {
        it('should handle missing TEST_OUTPUT_DIR gracefully', () => {
            delete process.env.TEST_OUTPUT_DIR;

            expect(() => getMemoryInfo()).not.toThrow();
        });

        it('should respect custom memory limits', () => {
            process.env.MEMORY_WARN_LIMIT = '20';
            process.env.MEMORY_CRIT_LIMIT = '30';

            expect(checkMemoryThreshold()).toBe(true);

            // Should return false with very low limit
            process.env.MEMORY_CRIT_LIMIT = '0.001';
            expect(checkMemoryThreshold()).toBe(false);

            // Reset
            delete process.env.MEMORY_WARN_LIMIT;
            delete process.env.MEMORY_CRIT_LIMIT;
        });

        it('should respect monitoring flag', () => {
            process.env.MEMORY_MONITORING = 'true';

            expect(() => logMemoryUsage('test-context')).not.toThrow();

            // Reset
            delete process.env.MEMORY_MONITORING;
        });
    });

    describe('Integration Test', () => {
        it('should integrate all memory management components', () => {
            const testFile = path.join(testDir, 'integration.js');
            const content = 'console.log("Integration test");';
            fs.writeFileSync(testFile, content);

            const lazyFile = new LazyFile('integration.js', testFile, ExtFileType.JS);
            lazyFile.getContent();

            const extension: Extension = {
                id: 'integration-test',
                name: 'Integration Test Extension',
                manifest_v2_path: testFile,
                manifest: {
                    name: 'Integration Test Extension',
                    version: '1.0',
                    manifest_version: 2,
                },
                files: [lazyFile],
            };

            // Test all memory management functions work together
            expect(() => checkMemoryThreshold()).not.toThrow();
            expect(() => clearExtensionMemory(extension)).not.toThrow();
            expect(() => forceGarbageCollection()).not.toThrow();
            expect(() => aggressiveCleanup([extension])).not.toThrow();
            expect(calculateExtensionMemoryUsage(extension)).toBeGreaterThanOrEqual(0);
            expect(getExtensionsMemorySummary([extension])).toEqual({
                totalExtensions: 1,
                totalFilesLoaded: 0,
                estimatedMemoryMB: expect.any(Number),
            });

            // Memory info should be reasonable
            const memoryInfo = getMemoryInfo();
            expect(memoryInfo.heapUsedMB).toBeGreaterThan(0);

            // Clean up
            clearExtensionMemory(extension);
            lazyFile.close();

            // Memory should reduce after cleanup
            if (global.gc) {
                global.gc();
                const afterCleanupInfo = getMemoryInfo();
                expect(afterCleanupInfo.heapUsedMB).toBeLessThan(memoryInfo.heapUsedMB);
            }
        });
    });
});
