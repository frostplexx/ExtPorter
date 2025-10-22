import { Extension } from './extension';

/**
 * Abstract base class for migration modules that transform extensions.
 *
 * This class provides a common interface for all migration modules that need to
 * modify or transform extension objects. Subclasses must override the migrate
 * method to implement their specific migration logic.
 *
 * @abstract
 */
export abstract class MigrationModule {
    /**
     * Migrates an extension by applying transformation logic.
     *
     * This method should be overridden by subclasses to implement specific
     * migration behavior. The default implementation throws an error to ensure
     * subclasses provide their own implementation.
     *
     * @param extension - The extension object to migrate
     * @returns {Extension} The migrated extension object or {null} of the migration fails
     * @throws {Error} When called directly on the base class without being overridden
     * @static
     */
    public static migrate(
        extension: Extension
    ): Promise<Extension | MigrationError> | Extension | MigrationError {
        throw new Error(`Method must be implemented by a subclass of MigrationModule`);
    }
}

export class MigrationError {
    extension: Extension;
    error: any;

    constructor(extension: Extension, error: any) {
        this.extension = extension;
        this.error = error;
    }
}
