import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { MigrationWriter } from '../../../migrator/modules/migration_writer';
import { logger } from '../../../migrator/utils/logger';
import { Extension } from '../../../migrator/types/extension';
import { AbstractFile } from '../../../migrator/types/abstract_file';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock dependencies
jest.mock('../../../migrator/utils/logger');
jest.mock('fs/promises');
jest.mock('../../../migrator/index', () => ({
    globals: {
        outputDir: '/test/output'
    }
}));

describe('MigrationWriter', () => {
    let mockExtension: Extension;
    let mockFile: jest.Mocked<AbstractFile>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockFile = {
            getContent: jest.fn().mockReturnValue('test content'),
            getPath: jest.fn().mockReturnValue('test.js'),
            getSize: jest.fn().mockReturnValue(100),
            getType: jest.fn().mockReturnValue('js' as any)
        } as any;

        mockExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {},
            files: [mockFile]
        } as Extension;

        // Mock fs methods
        (fs.mkdir as any).mockResolvedValue(void 0);
        (fs.writeFile as any).mockResolvedValue(void 0);
        (fs.access as any).mockResolvedValue(void 0);
    });

    afterEach(() => {
        // Reset singleton instance for each test
        (MigrationWriter as any).instance = null;
    });

    describe('shared', () => {
        it('should return singleton instance', () => {
            const instance1 = MigrationWriter.shared;
            const instance2 = MigrationWriter.shared;

            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(MigrationWriter);
        });
    });

    describe('queueExtension', () => {
        it('should queue extension for writing', async () => {
            const writer = MigrationWriter.shared;

            await expect(writer.queueExtension(mockExtension)).resolves.toBeUndefined();

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(1);
        });

        it('should respect priority ordering', async () => {
            const writer = MigrationWriter.shared;
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
            const writer = MigrationWriter.shared;
            const status = writer.getQueueStatus();

            expect(status).toHaveProperty('queueLength');
            expect(status).toHaveProperty('activeWriters');
            expect(typeof status.queueLength).toBe('number');
            expect(typeof status.activeWriters).toBe('number');
        });
    });

    describe('writeExtensionSync', () => {
        it('should write extension files synchronously', async () => {
            const writer = MigrationWriter.shared;
            const outputPath = '/test/output/test-extension';

            await expect(
                writer.writeExtensionSync(mockExtension, outputPath)
            ).resolves.toBeUndefined();

            expect(fs.mkdir).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenCalled();
        });

        it('should handle file writing errors', async () => {
            const writer = MigrationWriter.shared;
            const outputPath = '/test/output/test-extension';
            const error = new Error('Write failed');

            (fs.writeFile as any).mockRejectedValue(error);

            await expect(
                writer.writeExtensionSync(mockExtension, outputPath)
            ).rejects.toThrow('Write failed');
        });

        it('should create output directory if it does not exist', async () => {
            const writer = MigrationWriter.shared;
            const outputPath = '/test/output/test-extension';

            await writer.writeExtensionSync(mockExtension, outputPath);

            expect(fs.mkdir).toHaveBeenCalledWith(
                expect.stringContaining(outputPath),
                expect.objectContaining({ recursive: true })
            );
        });

        it('should write manifest.json file', async () => {
            const writer = MigrationWriter.shared;
            const outputPath = '/test/output/test-extension';

            await writer.writeExtensionSync(mockExtension, outputPath);

            expect(fs.writeFile).toHaveBeenCalledWith(
                expect.stringContaining('manifest.json'),
                expect.stringContaining(JSON.stringify(mockExtension.manifest, null, 2))
            );
        });
    });

    describe('flush', () => {
        it('should wait for all queued extensions to be written', async () => {
            const writer = MigrationWriter.shared;

            await writer.queueExtension(mockExtension);
            await expect(writer.flush()).resolves.toBeUndefined();

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(0);
            expect(status.activeWriters).toBe(0);
        });

        it('should handle multiple extensions in queue', async () => {
            const writer = MigrationWriter.shared;
            const ext1 = { ...mockExtension, id: 'ext1' };
            const ext2 = { ...mockExtension, id: 'ext2' };

            await writer.queueExtension(ext1);
            await writer.queueExtension(ext2);

            await expect(writer.flush()).resolves.toBeUndefined();

            const status = writer.getQueueStatus();
            expect(status.queueLength).toBe(0);
        });
    });
});