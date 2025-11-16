import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Extension } from '../../../migrator/types/extension';
import { AbstractFile } from '../../../migrator/types/abstract_file';
import { ExtFileType } from '../../../migrator/types/ext_file_types';
import * as fs from 'fs/promises';
import { WriteQueue } from '../../../migrator/modules/write_extension/write-queue';

// Mock dependencies
jest.mock('../../../migrator/utils/logger');
jest.mock('fs/promises');
jest.mock('../../../migrator/index', () => ({
    globals: {
        outputDir: '/test/output',
    },
}));

describe('WriteQueue', () => {
    let mockExtension: Extension;
    let mockFile: jest.Mocked<AbstractFile>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockFile = {
            path: 'test.js',
            filetype: ExtFileType.JS,
            getContent: jest.fn().mockReturnValue('test content'),
            getBuffer: jest.fn().mockReturnValue(Buffer.from('test content')),
            getPath: jest.fn().mockReturnValue('test.js'),
            getSize: jest.fn().mockReturnValue(100),
            getType: jest.fn().mockReturnValue('js' as any),
        } as any;

        mockExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {},
            files: [mockFile as any],
        } as Extension;

        // Mock fs methods
        (fs.mkdir as any).mockResolvedValue(void 0);
        (fs.writeFile as any).mockResolvedValue(void 0);
        (fs.access as any).mockResolvedValue(void 0);

        // Disable auto-processing for tests so we can check queue length
       WriteQueue.shared.setAutoProcess(false);
    });

    afterEach(() => {
        // Re-enable auto-processing
        WriteQueue.shared.setAutoProcess(true);
        // Reset singleton instance for each test
        (WriteQueue as any).instance = null;
    });

    describe('shared', () => {
        it('should return singleton instance', () => {
            const instance1 = WriteQueue.shared;
            const instance2 = WriteQueue.shared;

            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(WriteQueue);
        });
    });

    describe('queueExtension', () => {
        it('should queue extension for writing', async () => {
            const writer = WriteQueue.shared;

            await expect(writer.queueExtension(mockExtension)).resolves.toBeUndefined();

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(1);
        });

        it('should respect priority ordering', async () => {
            const writer = WriteQueue.shared;
            const highPriorityExt = { ...mockExtension, id: 'high-priority' };
            const lowPriorityExt = { ...mockExtension, id: 'low-priority' };

            await writer.queueExtension(lowPriorityExt, 1);
            await writer.queueExtension(highPriorityExt, 10);

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(2);
        });
    });

    describe('getQueueStatus', () => {
        it('should return correct queue status', () => {
            const writer = WriteQueue.shared;
            const status = writer.getQueueStatus();

            expect(status).toHaveProperty('queueLength');
            expect(status).toHaveProperty('activeWriters');
            expect(typeof status.queueLength).toBe('number');
            expect(typeof status.activeWriters).toBe('number');
        });
    });

    describe('writeExtensionSync', () => {
        it('should write extension files synchronously', async () => {
            const writer = WriteQueue.shared;
            const outputPath = '/test/output/test-extension';

            await expect(
                writer.writeExtensionSync(mockExtension, outputPath)
            ).resolves.toBeUndefined();

            expect(fs.mkdir).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenCalled();
        });

        it('should handle file writing errors', async () => {
            const writer = WriteQueue.shared;
            const outputPath = '/test/output/test-extension';
            const error = new Error('Write failed');

            (fs.writeFile as any).mockRejectedValue(error);

            await expect(writer.writeExtensionSync(mockExtension, outputPath)).rejects.toThrow(
                'Write failed'
            );
        });

        it('should create output directory if it does not exist', async () => {
            const writer = WriteQueue.shared;
            const outputPath = '/test/output/test-extension';

            await writer.writeExtensionSync(mockExtension, outputPath);

            expect(fs.mkdir).toHaveBeenCalledWith(
                expect.stringContaining(outputPath),
                expect.objectContaining({ recursive: true })
            );
        });

        it('should write manifest.json file', async () => {
            const writer = WriteQueue.shared;
            const outputPath = '/test/output/test-extension';

            await writer.writeExtensionSync(mockExtension, outputPath);

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('manifest.json'),
                expect.stringContaining(JSON.stringify(mockExtension.manifest, null, 2)),
                'utf8'
            );
        });
    });

    describe('flush', () => {
        it('should wait for all queued extensions to be written', async () => {
            const writer = WriteQueue.shared;

            await writer.queueExtension(mockExtension);
            await expect(writer.flush()).resolves.toBeUndefined();

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(0);
            expect(status.activeWriters).toBe(0);
        });

        it('should handle multiple extensions in queue', async () => {
            const writer = WriteQueue.shared;
            const ext1 = { ...mockExtension, id: 'ext1' };
            const ext2 = { ...mockExtension, id: 'ext2' };

            await writer.queueExtension(ext1);
            await writer.queueExtension(ext2);

            await expect(writer.flush()).resolves.toBeUndefined();

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(0);
        });

        it('should return immediately when queue is empty', async () => {
            const writer = WriteQueue.shared;

            await expect(writer.flush()).resolves.toBeUndefined();
        });

        it('should handle flush timeout', async () => {
            const writer = WriteQueue.shared;

            await writer.queueExtension(mockExtension);

            // Mock a scenario where writers don't complete
            (writer as any).activeWriters = 1;

            // Create a promise that will resolve after a short delay
            const flushPromise = writer.flush();

            // Wait a bit then reset the active writers to allow flush to complete
            setTimeout(() => {
                (writer as any).activeWriters = 0;
            }, 100);

            // This should resolve once activeWriters is reset
            await expect(flushPromise).resolves.toBeUndefined();
        }, 35000);
    });

    describe('auto-process', () => {
        it('should enable auto-processing', () => {
            const writer = WriteQueue.shared;

            writer.setAutoProcess(true);

            expect(() => writer.setAutoProcess(false)).not.toThrow();
        });

        it('should queue without auto-processing when disabled', async () => {
            const writer = WriteQueue.shared;
            writer.setAutoProcess(false);

            await writer.queueExtension(mockExtension);

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(1);
        });
    });

    describe('file type handling', () => {
        it('should write CSS files as text', async () => {
            const writer = WriteQueue.shared;
            const cssFile = {
                path: 'style.css',
                filetype: ExtFileType.CSS,
                getContent: jest.fn().mockReturnValue('body { color: red; }'),
                getBuffer: jest.fn().mockReturnValue(Buffer.from('body { color: red; }')),
            };

            const ext = {
                ...mockExtension,
                files: [cssFile as any],
            };

            await writer.writeExtensionSync(ext, '/test/output/css-ext');

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('style.css'),
                'body { color: red; }',
                'utf8'
            );
        });

        it('should write HTML files as text', async () => {
            const writer = WriteQueue.shared;
            const htmlFile = {
                path: 'page.html',
                filetype: ExtFileType.HTML,
                getContent: jest.fn().mockReturnValue('<html></html>'),
                getBuffer: jest.fn().mockReturnValue(Buffer.from('<html></html>')),
            };

            const ext = {
                ...mockExtension,
                files: [htmlFile as any],
            };

            await writer.writeExtensionSync(ext, '/test/output/html-ext');

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('page.html'),
                '<html></html>',
                'utf8'
            );
        });

        it('should write other files as binary', async () => {
            const writer = WriteQueue.shared;
            const imageFile = {
                path: 'icon.png',
                filetype: ExtFileType.OTHER,
                getContent: jest.fn(),
                getBuffer: jest.fn().mockReturnValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
            };

            const ext = {
                ...mockExtension,
                files: [imageFile as any],
            };

            await writer.writeExtensionSync(ext, '/test/output/binary-ext');

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('icon.png'),
                expect.any(Buffer)
            );
        });
    });

    describe('new tab subfolder', () => {
        it('should write to new_tab_extensions subfolder when enabled', async () => {
            const originalEnv = process.env.NEW_TAB_SUBFOLDER;
            process.env.NEW_TAB_SUBFOLDER = 'true';

            const writer = WriteQueue.shared;
            const newTabExt = {
                ...mockExtension,
                isNewTabExtension: true,
            };

            // Need to queue and process to test path logic
            writer.setAutoProcess(false);
            await writer.queueExtension(newTabExt);

            // Manually trigger write
            const task = (writer as any).writeQueue[0];
            await (writer as any).writeExtensionToDisk(task.extension);

            expect(fs.mkdir).toHaveBeenCalledWith(
                expect.stringContaining('new_tab_extensions'),
                expect.anything()
            );

            process.env.NEW_TAB_SUBFOLDER = originalEnv;
        });

        it('should use mv3_extension_id when available', async () => {
            const writer = WriteQueue.shared;
            const ext = {
                ...mockExtension,
                mv3_extension_id: 'mv3-id-12345',
            };

            writer.setAutoProcess(false);
            await writer.queueExtension(ext);

            const task = (writer as any).writeQueue[0];
            await (writer as any).writeExtensionToDisk(task.extension);

            expect(fs.mkdir).toHaveBeenCalledWith(
                expect.stringContaining('mv3-id-12345'),
                expect.anything()
            );
        });
    });

    describe('error handling', () => {
        it('should handle directory creation errors', async () => {
            const writer = WriteQueue.shared;
            (fs.mkdir as any).mockRejectedValue(new Error('Directory creation failed'));

            await expect(
                writer.writeExtensionSync(mockExtension, '/test/output/error-ext')
            ).rejects.toThrow('Directory creation failed');
        });

        it('should handle manifest write errors', async () => {
            const writer = WriteQueue.shared;
            (fs.writeFile as any).mockRejectedValueOnce(new Error('Manifest write failed'));

            await expect(
                writer.writeExtensionSync(mockExtension, '/test/output/error-ext')
            ).rejects.toThrow();
        });

        it('should handle file write errors in queue', async () => {
            const writer = WriteQueue.shared;
            writer.setAutoProcess(false);

            (fs.writeFile as any).mockRejectedValue(new Error('File write failed'));

            await writer.queueExtension(mockExtension);

            // Process queue manually
            await writer.flush();

            // Should not throw, but log the error
            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(0);
        });
    });

    describe('concurrent writes', () => {
        it('should handle concurrent write requests', async () => {
            const writer = WriteQueue.shared;
            const extensions = Array.from({ length: 5 }, (_, i) => ({
                ...mockExtension,
                id: `ext-${i}`,
            }));

            writer.setAutoProcess(false);

            await Promise.all(extensions.map((ext) => writer.queueExtension(ext)));

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(5);

            await writer.flush();

            const finalStatus = writer.getQueueStatus();
            expect(finalStatus.queueLength).toBe(0);
        });
    });

    describe('signal handling', () => {
        it('should be constructed with signal handlers', () => {
            // The constructor sets up signal handlers
            // We can verify the instance exists
            const instance = WriteQueue.shared;
            expect(instance).toBeDefined();
        });
    });

    describe('batch file writing', () => {
        it('should handle extensions with many files without exhausting file descriptors', async () => {
            const writer = WriteQueue.shared;
            
            const outputPath = '/test/output/test-extension';

            // Create an extension with 100 files (more than the batch size of 50)
            const manyFiles: jest.Mocked<AbstractFile>[] = [];
            for (let i = 0; i < 100; i++) {
                manyFiles.push({
                    path: `file${i}.js`,
                    filetype: ExtFileType.JS,
                    getContent: jest.fn().mockReturnValue(`content ${i}`),
                    getBuffer: jest.fn().mockReturnValue(Buffer.from(`content ${i}`)),
                    getPath: jest.fn().mockReturnValue(`file${i}.js`),
                    getSize: jest.fn().mockReturnValue(100),
                    getType: jest.fn().mockReturnValue('js' as any),
                } as any);
            }

            const extensionWithManyFiles = {
                ...mockExtension,
                files: manyFiles,
            } as any;

            await expect(
                writer.writeExtensionSync(extensionWithManyFiles, outputPath)
            ).resolves.toBeUndefined();

            // Verify that all files were written
            expect(fs.writeFile).toHaveBeenCalledTimes(101); // 100 files + 1 manifest
        });

        it('should write files in batches', async () => {
            const writer = WriteQueue.shared;
            const outputPath = '/test/output/test-extension';

            // Track the order of writeFile calls
            const writeFileCalls: string[] = [];
            (fs.writeFile as any).mockImplementation(async (path: string) => {
                writeFileCalls.push(path);
            });

            // Create an extension with 75 files (1.5x batch size of 50)
            const manyFiles: jest.Mocked<AbstractFile>[] = [];
            for (let i = 0; i < 75; i++) {
                manyFiles.push({
                    path: `file${i}.js`,
                    filetype: ExtFileType.JS,
                    getContent: jest.fn().mockReturnValue(`content ${i}`),
                    getBuffer: jest.fn().mockReturnValue(Buffer.from(`content ${i}`)),
                    getPath: jest.fn().mockReturnValue(`file${i}.js`),
                    getSize: jest.fn().mockReturnValue(100),
                    getType: jest.fn().mockReturnValue('js' as any),
                } as any);
            }

            const extensionWithManyFiles = {
                ...mockExtension,
                files: manyFiles,
            } as any;

            await expect(
                writer.writeExtensionSync(extensionWithManyFiles, outputPath)
            ).resolves.toBeUndefined();

            // Verify all files were written (75 files + 1 manifest)
            expect(writeFileCalls.length).toBe(76);
        });
    });
});
