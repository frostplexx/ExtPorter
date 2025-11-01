import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    formatMemoryUsage,
    logMemoryUsage,
    forceGarbageCollection,
    checkMemoryThreshold,
    clearExtensionMemory,
} from '../../../migrator/utils/garbage';
import { Extension } from '../../../migrator/types/extension';

describe('Garbage Collection Utils', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let originalGC: any;

    beforeEach(() => {
        originalEnv = { ...process.env };
        originalGC = (global as any).gc;
    });

    afterEach(() => {
        process.env = originalEnv;
        (global as any).gc = originalGC;
    });

    describe('formatMemoryUsage', () => {
        it('should format memory usage correctly', () => {
            const memoryUsage: NodeJS.MemoryUsage = {
                rss: 100 * 1024 * 1024, // 100 MB
                heapTotal: 50 * 1024 * 1024, // 50 MB
                heapUsed: 25 * 1024 * 1024, // 25 MB
                external: 10 * 1024 * 1024, // 10 MB
                arrayBuffers: 5 * 1024 * 1024, // 5 MB
            };

            const formatted = formatMemoryUsage(memoryUsage);

            expect(formatted).toContain('RSS: 100MB');
            expect(formatted).toContain('Heap Used: 25MB');
            expect(formatted).toContain('Heap Total: 50MB');
        });

        it('should round memory values', () => {
            const memoryUsage: NodeJS.MemoryUsage = {
                rss: 100.7 * 1024 * 1024,
                heapTotal: 50.3 * 1024 * 1024,
                heapUsed: 25.9 * 1024 * 1024,
                external: 0,
                arrayBuffers: 0,
            };

            const formatted = formatMemoryUsage(memoryUsage);

            expect(formatted).toMatch(/RSS: \d+MB/);
            expect(formatted).toMatch(/Heap Used: \d+MB/);
            expect(formatted).toMatch(/Heap Total: \d+MB/);
        });
    });

    describe('logMemoryUsage', () => {
        it('should log memory usage with debug level by default', () => {
            process.env.MEMORY_MONITORING = 'false';

            expect(() => logMemoryUsage('test context')).not.toThrow();
        });

        it('should log memory usage with info level when monitoring enabled', () => {
            process.env.MEMORY_MONITORING = 'true';

            expect(() => logMemoryUsage('test context')).not.toThrow();
        });
    });

    describe('forceGarbageCollection', () => {
        it('should call gc if available', () => {
            const mockGC = jest.fn();
            (global as any).gc = mockGC;
            process.env.MEMORY_MONITORING = 'false';

            forceGarbageCollection();

            expect(mockGC).toHaveBeenCalled();
        });

        it('should handle when gc is not available', () => {
            (global as any).gc = undefined;
            process.env.MEMORY_MONITORING = 'false';

            expect(() => forceGarbageCollection()).not.toThrow();
        });

        it('should log when monitoring is enabled and gc is available', () => {
            const mockGC = jest.fn();
            (global as any).gc = mockGC;
            process.env.MEMORY_MONITORING = 'true';

            expect(() => forceGarbageCollection()).not.toThrow();
            expect(mockGC).toHaveBeenCalled();
        });

        it('should warn when monitoring is enabled and gc is not available', () => {
            (global as any).gc = undefined;
            process.env.MEMORY_MONITORING = 'true';

            expect(() => forceGarbageCollection()).not.toThrow();
        });
    });

    describe('checkMemoryThreshold', () => {
        it('should return true when memory usage is normal', () => {
            // Set high thresholds
            process.env.MEMORY_CRIT_LIMIT = '10';
            process.env.MEMORY_WARN_LIMIT = '5';

            const result = checkMemoryThreshold();

            expect(result).toBe(true);
        });

        it('should return false when critical limit exceeded', () => {
            // Set very low critical threshold
            process.env.MEMORY_CRIT_LIMIT = '0.001';

            const result = checkMemoryThreshold();

            expect(result).toBe(false);
        });

        it('should warn when warning limit exceeded', () => {
            // Set low warning threshold, high critical threshold
            process.env.MEMORY_WARN_LIMIT = '0.001';
            process.env.MEMORY_CRIT_LIMIT = '100';

            const result = checkMemoryThreshold();

            expect(result).toBe(true);
        });

        it('should use default thresholds when not specified', () => {
            delete process.env.MEMORY_CRIT_LIMIT;
            delete process.env.MEMORY_WARN_LIMIT;

            const result = checkMemoryThreshold();

            expect(typeof result).toBe('boolean');
        });
    });

    describe('clearExtensionMemory', () => {
        it('should clear extension files', () => {
            const mockFile = {
                path: 'test.js',
                content: 'test content',
                cleanContent: jest.fn(),
                filetype: 'js',
                getContent: () => 'test',
                getBuffer: () => Buffer.from('test'),
            };

            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Test Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [mockFile as any],
            };

            clearExtensionMemory(extension);

            expect(mockFile.cleanContent).toHaveBeenCalled();
            expect(extension.files.length).toBe(0);
        });

        it('should preserve essential manifest info', () => {
            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Test Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                    description: 'A test extension',
                    permissions: ['storage', 'tabs'],
                },
                files: [],
            };

            clearExtensionMemory(extension);

            expect(extension.manifest.name).toBe('Test Extension');
            expect(extension.manifest.manifest_version).toBe(2);
            expect(extension.manifest.description).toBeUndefined();
        });

        it('should handle files without cleanContent method', () => {
            const mockFile = {
                path: 'test.js',
                content: 'test content',
                filetype: 'js',
                getContent: () => 'test',
                getBuffer: () => Buffer.from('test'),
            };

            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Test Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [mockFile as any],
            };

            expect(() => clearExtensionMemory(extension)).not.toThrow();
            expect(extension.files.length).toBe(0);
        });

        it('should handle extension with no files', () => {
            const extension: Extension = {
                id: 'test-ext',
                name: 'Test Extension',
                manifest_v2_path: '/test/path',
                manifest: {
                    name: 'Test Extension',
                    version: '1.0.0',
                    manifest_version: 2,
                },
                files: [],
            };

            expect(() => clearExtensionMemory(extension)).not.toThrow();
        });
    });
});
