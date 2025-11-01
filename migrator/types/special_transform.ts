
/**
 * Abstract base class for migration modules that transform extensions.
 *
 * This class provides a common interface for all migration modules that need to
 * modify or transform extension objects. Subclasses must override the migrate
 * method to implement their specific migration logic.
 *
 * @abstract
 */
export abstract class SpecialTransform {
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
    public static try_transform(
        node: any
    ): boolean {
        throw new Error(`Method must be implemented by subclass - ${node}`);
    }
}

