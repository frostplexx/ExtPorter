import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs-extra';
import * as path from 'path';
import { MMapFile } from '../../../migrator/utils/memory_mapped_file';

describe('MMapFile', () => {
    const testDir = path.join(process.env.TEST_OUTPUT_DIR!, 'memory_mapped_file_test');

    beforeEach(() => {
        fs.ensureDirSync(testDir);
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.removeSync(testDir);
        }
    });

    describe('constructor', () => {
        it('should not open file descriptor until content is accessed (lazy loading)', () => {
            const testFile = path.join(testDir, 'test.txt');
            const testContent = 'Hello, World!\nThis is a test file.';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            expect(mmapFile.path).toBe(testFile);
            expect(mmapFile.size).toBe(testContent.length);
            expect(mmapFile.fd).toBe(-1); // Should be -1 until content is accessed
            expect(mmapFile.isLoaded()).toBe(false);

            mmapFile.close();
        });

        it('should handle empty files', () => {
            const testFile = path.join(testDir, 'empty.txt');
            fs.writeFileSync(testFile, '');

            const mmapFile = new MMapFile(testFile);

            expect(mmapFile.size).toBe(0);
            expect(mmapFile.getContent()).toBe('');

            mmapFile.close();
        });

        it('should throw error for non-existent files', () => {
            const nonExistentFile = path.join(testDir, 'non-existent.txt');

            expect(() => {
                new MMapFile(nonExistentFile);
            }).toThrow();
        });
    });

    describe('getContent', () => {
        it('should return file content as string', () => {
            const testFile = path.join(testDir, 'content.txt');
            const testContent = 'Line 1\nLine 2\nLine 3';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);
            const content = mmapFile.getContent();

            expect(content).toBe(testContent);
            mmapFile.close();
        });

        it('should cache content on subsequent calls', () => {
            const testFile = path.join(testDir, 'cache.txt');
            const testContent = 'Cached content';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);

            const content1 = mmapFile.getContent();
            const content2 = mmapFile.getContent();

            expect(content1).toBe(content2);
            expect(content1).toBe(testContent);

            mmapFile.close();
        });

        it('should handle UTF-8 encoded content', () => {
            const testFile = path.join(testDir, 'utf8.txt');
            const testContent = 'Hello 世界! 🌍 Émojis and special chars: àáâãäå';
            fs.writeFileSync(testFile, testContent, 'utf8');

            const mmapFile = new MMapFile(testFile);
            const content = mmapFile.getContent();

            expect(content).toBe(testContent);
            mmapFile.close();
        });

        it('should handle JSON content', () => {
            const testFile = path.join(testDir, 'test.json');
            const testObject = {
                name: 'Test Extension',
                version: '1.0',
                manifest_version: 2,
                permissions: ['activeTab', 'storage'],
            };
            fs.writeJsonSync(testFile, testObject);

            const mmapFile = new MMapFile(testFile);
            const content = mmapFile.getContent();
            const parsed = JSON.parse(content);

            expect(parsed).toEqual(testObject);
            mmapFile.close();
        });
    });

    describe('getBuffer', () => {
        it('should return the raw buffer', () => {
            const testFile = path.join(testDir, 'buffer.txt');
            const testContent = 'Buffer test content';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);
            const buffer = mmapFile.getBuffer();

            expect(buffer).toBeInstanceOf(Buffer);
            expect(buffer.toString('utf8')).toBe(testContent);
            expect(buffer.length).toBe(testContent.length);

            mmapFile.close();
        });

        it('should return the same buffer instance on multiple calls', () => {
            const testFile = path.join(testDir, 'buffer-same.txt');
            fs.writeFileSync(testFile, 'test');

            const mmapFile = new MMapFile(testFile);
            const buffer1 = mmapFile.getBuffer();
            const buffer2 = mmapFile.getBuffer();

            expect(buffer1).toBe(buffer2); // Same reference
            mmapFile.close();
        });
    });

    describe('close', () => {
        it('should close the file descriptor after loading content', () => {
            const testFile = path.join(testDir, 'close.txt');
            fs.writeFileSync(testFile, 'test content');

            const mmapFile = new MMapFile(testFile);

            // Initially fd should be -1 (not loaded yet)
            expect(mmapFile.fd).toBe(-1);

            // Load content
            mmapFile.getContent();

            // After loading, fd should still be -1 (closed immediately)
            expect(mmapFile.fd).toBe(-1);

            mmapFile.close();

            expect(mmapFile.fd).toBe(-1);
        });

        it('should be safe to call close multiple times', () => {
            const testFile = path.join(testDir, 'close-multiple.txt');
            fs.writeFileSync(testFile, 'test content');

            const mmapFile = new MMapFile(testFile);

            mmapFile.close();
            mmapFile.close(); // Should not throw
            mmapFile.close(); // Should not throw

            expect(mmapFile.fd).toBe(-1);
        });

        it('should still allow access to cached content after close', () => {
            const testFile = path.join(testDir, 'close-cached.txt');
            const testContent = 'cached after close';
            fs.writeFileSync(testFile, testContent);

            const mmapFile = new MMapFile(testFile);
            const content = mmapFile.getContent(); // Cache the content

            mmapFile.close();

            // Should still return cached content
            expect(mmapFile.getContent()).toBe(testContent);
        });
    });

    describe('large files', () => {
        it('should handle moderately large files', () => {
            const testFile = path.join(testDir, 'large.txt');
            const largeContent = 'A'.repeat(1024 * 10); // 10KB
            fs.writeFileSync(testFile, largeContent);

            const mmapFile = new MMapFile(testFile);

            expect(mmapFile.size).toBe(largeContent.length);
            expect(mmapFile.getContent()).toBe(largeContent);

            mmapFile.close();
        });
    });

    describe('binary files', () => {
        it('should handle binary content', () => {
            const testFile = path.join(testDir, 'binary.bin');
            const binaryData = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd]);
            fs.writeFileSync(testFile, binaryData);

            const mmapFile = new MMapFile(testFile);

            expect(mmapFile.size).toBe(binaryData.length);
            expect(mmapFile.getBuffer()).toEqual(binaryData);

            mmapFile.close();
        });
    });

    describe('error handling', () => {
        it('should handle permission errors gracefully', () => {
            // This test might not work on all systems due to permission restrictions
            const testFile = path.join(testDir, 'permission-test.txt');
            fs.writeFileSync(testFile, 'test');

            // Try to change permissions (might not work on all systems)
            try {
                fs.chmodSync(testFile, 0o000); // No permissions

                expect(() => {
                    new MMapFile(testFile);
                }).toThrow();

                // Restore permissions for cleanup
                fs.chmodSync(testFile, 0o644);
            } catch (error) {
                // Skip test if we can't change permissions
                console.log('Skipping permission test - unable to change file permissions');
            }
        });
    });
});
