import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { logger } from '../../utils/logger';
import { extractListeners } from './listener-extractor';

/**
 * Migration module for extracting event listeners from extension code
 * This performs static analysis to find all chrome.* API event listeners
 */
export class ListenerAnalyzer implements MigrationModule {
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        try {
            logger.debug(extension, 'Starting listener extraction');

            const listeners = extractListeners(extension);

            // Add listeners to extension
            (extension as any).event_listeners = listeners;

            logger.debug(extension, `Extracted ${listeners.length} event listeners`, {
                listeners: listeners.slice(0, 10), // Log first 10 for debugging
            });

            return extension;
        } catch (error) {
            logger.error(extension, 'Failed to extract event listeners', { error });
            return new MigrationError(extension, error);
        }
    }
}
