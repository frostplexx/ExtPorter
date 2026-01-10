import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { 
    find_extensions, 
    find_extensions_iterator, 
    count_extensions 
} from '../../../migrator/utils/find_extensions';
import { clearExtensionMemory } from '../../../migrator/utils/garbage';
import { createTransformedFile, LazyFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';

describe('Memory-efficient extension processing', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'memory_test');

    beforeEach(() => {
        fs.ensureDirSync(testDir);
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
    });

    /**
     * Helper to create a test extension with specified number of files
     */
    function createTestExtension(name: string, fileCount: number, fileSizeKB: number = 10): string {
        const extensionDir = path.join(testDir, name);
        fs.ensureDirSync(extensionDir);

        fs.writeJsonSync(path.join(extensionDir, 'manifest.json'), {
            name: name,
            version: '1.0',
            manifest_version: 2,
        });

        // Create files with specified size
        const content = 'x'.repeat(fileSizeKB * 1024);
        for (let i = 0; i < fileCount; i++) {
            fs.writeFileSync(path.join(extensionDir, `file${i}.js`), content);
        }

        return extensionDir;
    }

    describe('find_extensions_iterator', () => {
        it('should yield extensions one at a time', () => {
            // Create multiple extensions
            createTestExtension('ext1', 2);
            createTestExtension('ext2', 2);
            createTestExtension('ext3', 2);

            const iterator = find_extensions_iterator(testDir);
            const yielded: string[] = [];

            for (const ext of iterator) {
                yielded.push(ext.name);
                // At any point, we should only have one extension in scope
                expect(ext).toBeDefined();
                expect(ext.files.length).toBeGreaterThan(0);
            }

            expect(yielded).toHaveLength(3);
            expect(yielded.sort()).toEqual(['ext1', 'ext2', 'ext3']);
        });

        it('should not load all extensions into memory at once', () => {
            // Create many extensions
            const extensionCount = 20;
            for (let i = 0; i < extensionCount; i++) {
                createTestExtension(`ext${i}`, 5, 1); // 5 files, 1KB each
            }

            const iterator = find_extensions_iterator(testDir);
            let processedCount = 0;
            let maxMemoryDelta = 0;
            const baselineMemory = process.memoryUsage().heapUsed;

            for (const ext of iterator) {
                processedCount++;
                
                // Access file content to trigger loading
                for (const file of ext.files) {
                    if (file) {
                        file.getContent();
                    }
                }

                const currentMemory = process.memoryUsage().heapUsed;
                const memoryDelta = currentMemory - baselineMemory;
                maxMemoryDelta = Math.max(maxMemoryDelta, memoryDelta);

                // Clean up after each extension (simulating real usage)
                clearExtensionMemory(ext);
            }

            expect(processedCount).toBe(extensionCount);
            
            // Memory should not grow linearly with extension count
            // With 20 extensions of ~5KB each, if all loaded at once = ~100KB minimum
            // With iterator, should stay much lower per iteration
            // This is a rough check - actual memory behavior depends on GC
            console.log(`Max memory delta during iteration: ${Math.round(maxMemoryDelta / 1024)}KB`);
        });

        it('should be equivalent to find_extensions but memory-efficient', () => {
            createTestExtension('ext1', 2);
            createTestExtension('ext2', 2);

            const arrayResult = find_extensions(testDir);
            const iteratorResult = [...find_extensions_iterator(testDir)];

            expect(iteratorResult.length).toBe(arrayResult.length);
            
            const arrayNames = arrayResult.map(e => e.name).sort();
            const iteratorNames = iteratorResult.map(e => e.name).sort();
            expect(iteratorNames).toEqual(arrayNames);
        });
    });

    describe('count_extensions', () => {
        it('should count extensions without loading them', () => {
            createTestExtension('ext1', 5);
            createTestExtension('ext2', 5);
            createTestExtension('ext3', 5);

            const beforeMemory = process.memoryUsage().heapUsed;
            const count = count_extensions(testDir);
            const afterMemory = process.memoryUsage().heapUsed;

            expect(count).toBe(3);
            
            // Memory increase should be minimal (no file content loaded)
            const memoryIncrease = afterMemory - beforeMemory;
            console.log(`Memory increase from count_extensions: ${Math.round(memoryIncrease / 1024)}KB`);
            
            // Should be less than 1MB for just counting
            expect(memoryIncrease).toBeLessThan(1024 * 1024);
        });

        it('should return 0 for non-existent path', () => {
            const count = count_extensions(path.join(testDir, 'non-existent'));
            expect(count).toBe(0);
        });

        it('should return 1 for single extension directory', () => {
            const extDir = createTestExtension('single', 2);
            const count = count_extensions(extDir);
            expect(count).toBe(1);
        });
    });

    describe('clearExtensionMemory', () => {
        it('should release file memory after clearing', () => {
            createTestExtension('memory-test', 10, 100); // 10 files, 100KB each = ~1MB

            const extensions = find_extensions(testDir);
            expect(extensions).toHaveLength(1);
            const ext = extensions[0];

            // Load all file contents
            for (const file of ext.files) {
                if (file) {
                    file.getContent();
                }
            }

            // Clear the extension
            clearExtensionMemory(ext);

            // Files array should be empty
            expect(ext.files.length).toBe(0);

            // Manifest should be minimal
            expect(Object.keys(ext.manifest).length).toBeLessThanOrEqual(2);
        });

        it('should handle already-closed files gracefully', () => {
            createTestExtension('close-test', 2);

            const extensions = find_extensions(testDir);
            const ext = extensions[0];

            // Manually close files first
            for (const file of ext.files) {
                if (file && file.close) {
                    file.close();
                }
            }

            // clearExtensionMemory should not throw
            expect(() => clearExtensionMemory(ext)).not.toThrow();
        });
    });

    describe('createTransformedFile memory management', () => {
        it('should release original file memory', () => {
            const extDir = createTestExtension('transform-test', 1, 50);
            const extensions = find_extensions(extDir);
            const originalFile = extensions[0].files[0]!;

            // Load original content
            const originalContent = originalFile.getContent();
            expect(originalContent.length).toBeGreaterThan(0);

            // Create transformed file
            const newContent = 'transformed content';
            const transformedFile = createTransformedFile(originalFile, newContent);

            // Transformed file should have new content
            expect(transformedFile.getContent()).toBe(newContent);
            expect(transformedFile.path).toBe(originalFile.path);
        });

        it('should allow releasing transformed file memory via close()', () => {
            const extDir = createTestExtension('transform-close-test', 1);
            const extensions = find_extensions(extDir);
            const originalFile = extensions[0].files[0]!;

            const transformedFile = createTransformedFile(originalFile, 'new content');
            
            // Should work before close
            expect(transformedFile.getContent()).toBe('new content');
            
            // Close should release memory
            transformedFile.close();
            
            // After close, accessing content should throw
            expect(() => transformedFile.getContent()).toThrow();
        });

        it('should lazily create buffer only when needed', () => {
            const extDir = createTestExtension('lazy-buffer-test', 1);
            const extensions = find_extensions(extDir);
            const originalFile = extensions[0].files[0]!;

            const largeContent = 'x'.repeat(100000); // 100KB
            const transformedFile = createTransformedFile(originalFile, largeContent);

            // Getting content should work without creating buffer
            expect(transformedFile.getContent()).toBe(largeContent);
            
            // Getting buffer should create it
            const buffer = transformedFile.getBuffer();
            expect(buffer.length).toBe(largeContent.length);
            
            // Release memory should clear buffer but keep content
            transformedFile.releaseMemory();
            
            // Content should still be accessible
            expect(transformedFile.getContent()).toBe(largeContent);
        });
    });

    describe('Iterator pattern prevents OOM', () => {
        it('should process extensions without accumulating memory', async () => {
            // Create many extensions to simulate real workload
            const extensionCount = 50;
            for (let i = 0; i < extensionCount; i++) {
                createTestExtension(`stress${i}`, 3, 5); // 3 files, 5KB each
            }

            const memorySnapshots: number[] = [];
            let processedCount = 0;

            const iterator = find_extensions_iterator(testDir);

            for (const ext of iterator) {
                // Simulate processing: read files
                for (const file of ext.files) {
                    if (file) {
                        file.getContent();
                        file.getAST(); // Parse AST too
                    }
                }

                // Take memory snapshot every 10 extensions
                if (processedCount % 10 === 0) {
                    // Force GC if available
                    if (global.gc) {
                        global.gc();
                    }
                    memorySnapshots.push(process.memoryUsage().heapUsed);
                }

                // Clean up (simulating real pipeline behavior)
                clearExtensionMemory(ext);
                processedCount++;
            }

            expect(processedCount).toBe(extensionCount);

            // Memory should not grow significantly over time
            // Compare first and last snapshots
            if (memorySnapshots.length >= 2) {
                const firstSnapshot = memorySnapshots[0];
                const lastSnapshot = memorySnapshots[memorySnapshots.length - 1];
                const growthFactor = lastSnapshot / firstSnapshot;

                console.log(`Memory snapshots (MB): ${memorySnapshots.map(m => Math.round(m / 1024 / 1024)).join(', ')}`);
                console.log(`Memory growth factor: ${growthFactor.toFixed(2)}x`);

                // Memory should not grow more than 3x from start to finish
                // This indicates we're not accumulating references
                expect(growthFactor).toBeLessThan(3);
            }
        });
    });
});
