import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { WriteQueue } from './write-queue';
import { logger } from '../../utils/logger';

/**
 * WriteMigrated is a migration module that queues extensions for asynchronous writing.
 * This is the final step in the migration pipeline.
 */
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
