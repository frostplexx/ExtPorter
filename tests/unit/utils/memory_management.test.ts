import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { MMapFile } from '../../../migrator/utils/memory_mapped_file';
import { LazyFile, createTransformedFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
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

describe('Memory Management', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'memory_management_test');
    let originalEnv: NodeJS.ProcessEnv;
    let originalGC: any;

    beforeEach(() => {
        fs.ensureDirSync(testDir);
        originalEnv = { ...process.env };
        originalGC = (global as any).gc;
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
        process.env = originalEnv;
        (global as any).gc = originalGC;
    });

    describe('MMapFile lazy loading', () => {
        it('should not read file content in constructor', () => {
            const testFile = path.join(testDir, 'lazy.txt');
            const testContent = 'A'.repeat(1000);
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            // Buffer should be null until content is accessed
            expect(mmapFile.buffer).toBeNull();
            expect(mmapFile.isLoaded()).toBe(false);
            expect(mmapFile.size).toBe(testContent.length); // Size should be known

            mmapFile.close();
        });

        it('should read content only on first getContent() call', () => {
            const testFile = path.join(testDir, 'lazy-content.txt');
            const testContent = 'Test content for lazy loading';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            expect(mmapFile.isLoaded()).toBe(false);

            const content = mmapFile.getContent();

            expect(content).toBe(testContent);
            expect(mmapFile.isLoaded()).toBe(true);
            expect(mmapFile.buffer).not.toBeNull();

            mmapFile.close();
        });

        it('should read content only on first getBuffer() call', () => {
            const testFile = path.join(testDir, 'lazy-buffer.txt');
            const testContent = 'Buffer test content';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            expect(mmapFile.isLoaded()).toBe(false);

            const buffer = mmapFile.getBuffer();

            expect(buffer.toString()).toBe(testContent);
            expect(mmapFile.isLoaded()).toBe(true);

            mmapFile.close();
        });

        it('should allow re-reading after releaseMemory()', () => {
            const testFile = path.join(testDir, 'release.txt');
            const testContent = 'Content to release and re-read';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            // First read
            const content1 = mmapFile.getContent();
            expect(content1).toBe(testContent);
            expect(mmapFile.isLoaded()).toBe(true);

            // Release memory
            mmapFile.releaseMemory();
            expect(mmapFile.isLoaded()).toBe(false);
            expect(mmapFile.buffer).toBeNull();

            // Re-read
            const content2 = mmapFile.getContent();
            expect(content2).toBe(testContent);
            expect(mmapFile.isLoaded()).toBe(true);

            mmapFile.close();
        });

        it('should report correct memory usage', () => {
            const testFile = path.join(testDir, 'memory.txt');
            const testContent = 'A'.repeat(1000);
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            // Before loading
            expect(mmapFile.getMemoryUsage()).toBe(0);

            // After loading
            mmapFile.getContent();
            expect(mmapFile.getMemoryUsage()).toBeGreaterThan(0);

            // After release
            mmapFile.releaseMemory();
            expect(mmapFile.getMemoryUsage()).toBe(0);

            mmapFile.close();
        });

        it('should close file descriptor immediately after reading', () => {
            const testFile = path.join(testDir, 'fd.txt');
            fs.writeFileSync(testFile, 'test content');

            const mmapFile = new MMapFile(testFile);

            // FD should be -1 in constructor (not opened yet)
            expect(mmapFile.fd).toBe(-1);

            // After reading, FD should still be -1 (closed immediately)
            mmapFile.getContent();
            expect(mmapFile.fd).toBe(-1);

            mmapFile.close();
        });
    });

    describe('LazyFile resource management', () => {
        it('should release MMapFile memory on releaseMemory()', () => {
            const testFile = path.join(testDir, 'lazy-release.js');
            fs.writeFileSync(testFile, 'const x = 1;');

            const lazyFile = new LazyFile('test.js', testFile, ExtFileType.JS);

            // Load content
            lazyFile.getContent();
            expect(lazyFile.isLoaded()).toBe(true);

            // Release memory
            lazyFile.releaseMemory();
            expect(lazyFile.isLoaded()).toBe(false);

            lazyFile.close();
        });

        it('should allow re-reading after releaseMemory()', () => {
            const testFile = path.join(testDir, 'lazy-reread.js');
            const content = 'const test = "hello";';
            fs.writeFileSync(testFile, content);

            const lazyFile = new LazyFile('test.js', testFile, ExtFileType.JS);

            // First read
            expect(lazyFile.getContent()).toBe(content);

            // Release
            lazyFile.releaseMemory();

            // Re-read
            expect(lazyFile.getContent()).toBe(content);

            lazyFile.close();
        });

        it('should clear AST cache on releaseMemory()', () => {
            const testFile = path.join(testDir, 'lazy-ast.js');
            fs.writeFileSync(testFile, 'const x = 1;');

            const lazyFile = new LazyFile('test.js', testFile, ExtFileType.JS);

            // Parse AST
            const ast1 = lazyFile.getAST();
            expect(ast1).toBeDefined();

            // Release memory
            lazyFile.releaseMemory();

            // AST should be re-parsed on next call
            const ast2 = lazyFile.getAST();
            expect(ast2).toBeDefined();
            // Note: They might not be the same object reference

            lazyFile.close();
        });
    });

    describe('createTransformedFile', () => {
        it('should create transformed file with new content', () => {
            const testFile = path.join(testDir, 'original.js');
            const originalContent = 'const x = 1;';
            const newContent = 'const y = 2;';
            fs.writeFileSync(testFile, originalContent);

            const originalFile = new LazyFile('test.js', testFile, ExtFileType.JS);
            originalFile.getContent(); // Load it

            const transformed = createTransformedFile(originalFile, newContent);

            expect(transformed.getContent()).toBe(newContent);
            expect(transformed.path).toBe(originalFile.path);
            expect(transformed.filetype).toBe(originalFile.filetype);

            originalFile.close();
        });

        it('should release original file memory when transforming', () => {
            const testFile = path.join(testDir, 'transform-release.js');
            const originalContent = 'const x = 1;';
            fs.writeFileSync(testFile, originalContent);

            const originalFile = new LazyFile('test.js', testFile, ExtFileType.JS);
            originalFile.getContent(); // Load it
            expect(originalFile.isLoaded()).toBe(true);

            createTransformedFile(originalFile, 'const y = 2;');

            // Original file's memory should be released
            expect(originalFile.isLoaded()).toBe(false);

            originalFile.close();
        });

        it('should work with files that have no releaseMemory method', () => {
            // Create a mock file without releaseMemory
            const mockFile: any = {
                path: 'test.js',
                filetype: ExtFileType.JS,
                getContent: () => 'const x = 1;',
                getBuffer: () => Buffer.from('const x = 1;'),
                getSize: () => 13,
                getAST: () => undefined,
                close: () => {},
            };

            // Should not throw
            expect(() => {
                createTransformedFile(mockFile, 'const y = 2;');
            }).not.toThrow();
        });
    });

    describe('Memory thresholds', () => {
        it('should use 32GB critical limit by default', () => {
            delete process.env.MEMORY_CRIT_LIMIT;
            delete process.env.MEMORY_WARN_LIMIT;

            // With normal memory usage, this should return true
            const result = checkMemoryThreshold();
            expect(result).toBe(true);
        });

        it('should return false when critical limit exceeded', () => {
            // Set a very low critical limit
            process.env.MEMORY_CRIT_LIMIT = '0.001';

            const result = checkMemoryThreshold();
            expect(result).toBe(false);
        });

        it('should return true when within limits', () => {
            // Set very high limits
            process.env.MEMORY_CRIT_LIMIT = '100';
            process.env.MEMORY_WARN_LIMIT = '50';

            const result = checkMemoryThreshold();
            expect(result).toBe(true);
        });

        it('should trigger GC check at configured threshold', () => {
            // Set a high threshold - should not trigger
            expect(shouldTriggerGC(100)).toBe(false);

            // Set a very low threshold - should trigger
            expect(shouldTriggerGC(0.001)).toBe(true);
        });
    });

    describe('getMemoryInfo', () => {
        it('should return correct MemoryInfo structure', () => {
            const info = getMemoryInfo();

            expect(typeof info.heapUsedMB).toBe('number');
            expect(typeof info.heapTotalMB).toBe('number');
            expect(typeof info.rssMB).toBe('number');
            expect(typeof info.externalMB).toBe('number');
            expect(typeof info.arrayBuffersMB).toBe('number');
            expect(typeof info.heapUsedGB).toBe('number');
            expect(typeof info.rssGB).toBe('number');

            // Values should be non-negative
            expect(info.heapUsedMB).toBeGreaterThanOrEqual(0);
            expect(info.rssMB).toBeGreaterThanOrEqual(0);
        });
    });

    describe('formatMemoryUsage', () => {
        it('should format memory correctly', () => {
            const memoryUsage: NodeJS.MemoryUsage = {
                rss: 100 * 1024 * 1024,
                heapTotal: 50 * 1024 * 1024,
                heapUsed: 25 * 1024 * 1024,
                external: 10 * 1024 * 1024,
                arrayBuffers: 5 * 1024 * 1024,
            };

            const formatted = formatMemoryUsage(memoryUsage);

            expect(formatted).toContain('RSS: 100MB');
            expect(formatted).toContain('Heap Used: 25MB');
            expect(formatted).toContain('Heap Total: 50MB');
        });
    });

    describe('Extension memory cleanup', () => {
        it('should clear all file content on clearExtensionMemory()', () => {
            const testFile = path.join(testDir, 'ext-file.js');
            fs.writeFileSync(testFile, 'const x = 1;');

            const lazyFile = new LazyFile('test.js', testFile, ExtFileType.JS);
            lazyFile.getContent(); // Load it

            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test',
                manifest: {
                    name: 'Test',
                    version: '1.0',
                    manifest_version: 2,
                },
                files: [lazyFile],
            };

            clearExtensionMemory(extension);

            expect(extension.files.length).toBe(0);
        });

        it('should preserve essential manifest info', () => {
            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test',
                manifest: {
                    name: 'Test',
                    version: '1.0',
                    manifest_version: 2,
                    description: 'A test',
                    permissions: ['tabs'],
                },
                files: [],
            };

            clearExtensionMemory(extension);

            expect(extension.manifest.name).toBe('Test Extension');
            expect(extension.manifest.manifest_version).toBe(2);
            expect(extension.manifest.description).toBeUndefined();
        });
    });

    describe('aggressiveCleanup', () => {
        it('should clear all extensions and trigger GC', () => {
            const mockGC = jest.fn();
            (global as any).gc = mockGC;

            const extensions: Extension[] = [
                {
                    id: 'ext1',
                    name: 'Ext 1',
                    manifest_v2_path: '/test1',
                    manifest: { name: 'Ext 1', version: '1.0', manifest_version: 2 },
                    files: [],
                },
                {
                    id: 'ext2',
                    name: 'Ext 2',
                    manifest_v2_path: '/test2',
                    manifest: { name: 'Ext 2', version: '1.0', manifest_version: 2 },
                    files: [],
                },
            ];

            aggressiveCleanup(extensions);

            expect(extensions.length).toBe(0);
            expect(mockGC).toHaveBeenCalled();
        });
    });

    describe('periodicMemoryCheck', () => {
        it('should return true when memory is healthy', () => {
            process.env.MEMORY_CRIT_LIMIT = '100';
            process.env.MEMORY_WARN_LIMIT = '50';

            const result = periodicMemoryCheck('test');
            expect(result).toBe(true);
        });

        it('should return false when memory is critical', () => {
            process.env.MEMORY_CRIT_LIMIT = '0.001';

            const result = periodicMemoryCheck('test');
            expect(result).toBe(false);
        });
    });

    describe('calculateExtensionMemoryUsage', () => {
        it('should calculate memory usage of extension files', () => {
            const testFile = path.join(testDir, 'calc-mem.js');
            const content = 'A'.repeat(1000);
            fs.writeFileSync(testFile, content);

            const lazyFile = new LazyFile('test.js', testFile, ExtFileType.JS);
            lazyFile.getContent(); // Load it

            const extension: Extension = {
                id: 'test-ext',
                name: 'Test',
                manifest_v2_path: '/test',
                manifest: { name: 'Test', version: '1.0', manifest_version: 2 },
                files: [lazyFile],
            };

            const usage = calculateExtensionMemoryUsage(extension);
            expect(usage).toBeGreaterThan(0);

            lazyFile.close();
        });
    });

    describe('getExtensionsMemorySummary', () => {
        it('should return summary of loaded extensions', () => {
            const testFile = path.join(testDir, 'summary.js');
            fs.writeFileSync(testFile, 'const x = 1;');

            const lazyFile = new LazyFile('test.js', testFile, ExtFileType.JS);
            lazyFile.getContent(); // Load it

            const extensions: Extension[] = [
                {
                    id: 'test-ext',
                    name: 'Test',
                    manifest_v2_path: '/test',
                    manifest: { name: 'Test', version: '1.0', manifest_version: 2 },
                    files: [lazyFile],
                },
            ];

            const summary = getExtensionsMemorySummary(extensions);

            expect(summary.totalExtensions).toBe(1);
            expect(summary.totalFilesLoaded).toBeGreaterThanOrEqual(0);
            expect(typeof summary.estimatedMemoryMB).toBe('number');

            lazyFile.close();
        });

        it('should handle empty array', () => {
            const summary = getExtensionsMemorySummary([]);

            expect(summary.totalExtensions).toBe(0);
            expect(summary.totalFilesLoaded).toBe(0);
            expect(summary.estimatedMemoryMB).toBe(0);
        });
    });

    describe('forceGarbageCollection', () => {
        it('should call gc if available', () => {
            const mockGC = jest.fn();
            (global as any).gc = mockGC;

            forceGarbageCollection();

            expect(mockGC).toHaveBeenCalled();
        });

        it('should handle when gc is not available', () => {
            (global as any).gc = undefined;

            expect(() => forceGarbageCollection()).not.toThrow();
        });
    });

    describe('logMemoryUsage', () => {
        it('should not throw when logging', () => {
            expect(() => logMemoryUsage('test context')).not.toThrow();
        });

        it('should use info level when monitoring enabled', () => {
            process.env.MEMORY_MONITORING = 'true';
            expect(() => logMemoryUsage('test context')).not.toThrow();
        });
    });
});

describe('Database Queue Management', () => {
    // Note: These tests would require mocking the Database class
    // which is complex due to the singleton pattern.
    // The implementation includes queue size limits and backpressure.

    it('should have maxQueueSize defined', async () => {
        // This is a basic check - full integration test would need DB mocking
        const { Database } = await import('../../../migrator/features/database/db_manager');
        const status = Database.shared.getQueueStatus();
        expect(typeof status.maxSize).toBe('number');
        expect(status.maxSize).toBe(1000);
    });
});

describe('Logger Batch Management', () => {
    it('should expose getStats method', async () => {
        const { logger } = await import('../../../migrator/utils/logger');
        const stats = logger.getStats();

        expect(typeof stats.batchSize).toBe('number');
        expect(typeof stats.droppedCount).toBe('number');
        expect(typeof stats.maxBatchSize).toBe('number');
        expect(stats.maxBatchSize).toBe(100);
    });
});
