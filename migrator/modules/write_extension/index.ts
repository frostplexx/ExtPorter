import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { WriteQueue } from './write-queue';

export class WriteMigrated implements MigrationModule {
    public static migrate(extension: Extension): Extension | MigrationError {
        try {
            WriteQueue.shared.queueExtension(extension);

            logger.debug(extension, 'Extension queued for async write', {
                extensionName: extension.name,
                extensionId: extension.id,
            });

            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to queue extension for writing', {
                extensionName: extension.name,
                extensionId: extension.id,
                error: error instanceof Error ? error.message : String(error),
            });

            return new MigrationError(extension, error);
        }
    }
}


export interface WriteTask {
    extension: Extension;
    priority?: number;
}
