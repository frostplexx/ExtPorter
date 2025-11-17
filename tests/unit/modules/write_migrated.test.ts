import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { logger } from '../../../migrator/utils/logger';
import { Extension } from '../../../migrator/types/extension';
import { MigrationError } from '../../../migrator/types/migration_module';
import { WriteMigrated } from '../../../migrator/modules/write_extension';
import { WriteQueue } from '../../../migrator/modules/write_extension/write-queue';

// Mock dependencies
jest.mock('../../../migrator/utils/logger');

describe('WriteMigrated', () => {
    let mockExtension: Extension;
    let queueExtensionSpy: jest.SpiedFunction<typeof WriteQueue.shared.queueExtension>;

    beforeEach(() => {
        jest.clearAllMocks();

        mockExtension = {
            id: 'test-extension',
            name: 'Test Extension',
            manifest_v2_path: '/test/path',
            manifest: {},
            files: [],
        } as Extension;

        // Spy on WriteQueue.shared.queueExtension
        queueExtensionSpy = jest
            .spyOn(WriteQueue.shared, 'queueExtension')
            .mockResolvedValue(undefined);
    });

    describe('migrate', () => {
        it('should successfully queue extension and return it', () => {
            const result = WriteMigrated.migrate(mockExtension);

            expect(queueExtensionSpy).toHaveBeenCalledWith(mockExtension);
            expect(logger.debug).toHaveBeenCalledWith(
                mockExtension,
                'Extension queued for async write',
                {
                    extensionName: mockExtension.name,
                    extensionId: mockExtension.id,
                }
            );
            expect(result).toBe(mockExtension);
        });

        it('should handle errors and return MigrationError', () => {
            const error = new Error('Queue failed');
            queueExtensionSpy.mockImplementation(() => {
                throw error;
            });

            const result = WriteMigrated.migrate(mockExtension);

            expect(logger.error).toHaveBeenCalledWith(
                mockExtension,
                'Failed to queue extension for writing',
                {
                    extensionName: mockExtension.name,
                    extensionId: mockExtension.id,
                    error: 'Queue failed',
                }
            );
            expect(result).toBeInstanceOf(MigrationError);
            expect((result as MigrationError).extension).toBe(mockExtension);
        });

        it('should handle non-Error objects thrown', () => {
            const errorMessage = 'String error';
            queueExtensionSpy.mockImplementation(() => {
                throw errorMessage;
            });

            const result = WriteMigrated.migrate(mockExtension);

            expect(logger.error).toHaveBeenCalledWith(
                mockExtension,
                'Failed to queue extension for writing',
                {
                    extensionName: mockExtension.name,
                    extensionId: mockExtension.id,
                    error: 'String error',
                }
            );
            expect(result).toBeInstanceOf(MigrationError);
        });
    });
});
