import { Extension } from '../../types/extension';
import { MigrationError, MigrationModule } from '../../types/migration_module';
import { LazyFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';
import * as espree from 'espree';
import * as ESTree from 'estree';
import { logger } from '../../utils/logger';
import { Tags } from '../../types/tags';
import { TwinningMapping } from '../../types/twinning_mapping';
import { BlacklistChecker } from '../../utils/blacklist_checker';
import { FormatPreservingGenerator } from '../../utils/format_preserving_generator';
import { loadApiMappings } from './api-mappings-loader';
import { applyApiTransformations } from './ast-transformers';

/**
 * This module handles the transformation of Chrome Extension Manifest V2 APIs
 * to their Manifest V3 equivalents using AST-based transformations.
 */
export class RenameAPIS implements MigrationModule {
    /**
     * Cached blacklist checker instance (singleton pattern).
     * Reused across all migrations for performance.
     */
    private static readonly blacklistChecker = BlacklistChecker.getInstance();

    /**
     * Shared espree parser options for script parsing.
     * Cached to avoid object creation overhead.
     */
    private static readonly SCRIPT_PARSE_OPTIONS = {
        ecmaVersion: 'latest' as const,
        sourceType: 'script' as const,
        loc: true,
        range: true,
    };

    /**
     * Shared espree parser options for module parsing.
     * Cached to avoid object creation overhead.
     */
    private static readonly MODULE_PARSE_OPTIONS = {
        ecmaVersion: 'latest' as const,
        sourceType: 'module' as const,
        loc: true,
        range: true,
    };

    /**
     * Processes all JavaScript files in the extension and
     * applies API transformations based on the loaded mapping rules.
     */
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
        const startTime = Date.now();

        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Load API mappings (cached after first load for performance)
            const mappings = loadApiMappings();

            // Return if no mappings available
            if (mappings.mappings.length === 0) {
                return new MigrationError(extension, new Error('No API mappings available'));
            }

            let hasChanges = false;
            let processedFiles = 0;
            let transformedFiles = 0;
            let blacklistedFiles = 0;

            const transformedFilesArray = extension.files.map((file) => {
                // skip files that arent js
                if (file.filetype !== ExtFileType.JS) {
                    return file;
                }

                // Check if file is blacklisted from transformation (with content signature detection)
                const fileContent = file.getContent();

                const blacklistResult = RenameAPIS.blacklistChecker.isFileBlacklisted(
                    file.path,
                    fileContent
                );
                if (blacklistResult.isBlacklisted) {
                    blacklistedFiles++;
                    logger.debug(extension, 'File blacklisted from transformation', {
                        filePath: file.path,
                        reason: blacklistResult.reason,
                    });
                    return file; // Return original file without transformation
                }

                processedFiles++;
                return RenameAPIS.processJavaScriptFile(
                    file,
                    mappings,
                    extension,
                    (transformed) => {
                        if (transformed) {
                            hasChanges = true;
                            transformedFiles++;
                        }
                    }
                );
            });

            RenameAPIS.logMigrationResults(
                startTime,
                extension,
                processedFiles,
                transformedFiles,
                blacklistedFiles
            );

            // Return original extension if no changes were made
            if (!hasChanges) {
                return extension;
            }

            // Create updated extension with transformed files
            const updatedExtension = {
                ...extension,
                files: transformedFilesArray,
            };

            // Add API_RENAMES_APPLIED tag to extension object
            RenameAPIS.addTagToExtension(updatedExtension, Tags.API_RENAMES_APPLIED);

            return updatedExtension;
        } catch (error) {
            RenameAPIS.handleMigrationError(error, extension, startTime);
            return new MigrationError(extension, error);
        }
    }

    /**
     * Processes a single JavaScript file for API transformations.
     *
     * @param file The file to process
     * @param mappings API transformation mappings
     * @param extension Extension context for logging
     * @param onTransformed Callback to track if transformation occurred
     * @returns Original file or transformed file
     */
    private static processJavaScriptFile(
        file: LazyFile,
        mappings: TwinningMapping,
        extension: Extension | undefined,
        onTransformed: (transformed: boolean) => void
    ): LazyFile {
        const ast = file.getAST();

        if (!ast) {
            const fileSize = file.getSize();
            const fileSizeKB = Math.round(fileSize / 1024);
            const content = file.getContent();
            const isWebpackBundle = RenameAPIS.blacklistChecker.isWebpackBundle(content);

            logger.error(null, `AST parsing failed for file ${file.path}`, {
                path: file.path,
                fileSizeKB: fileSizeKB,
                isWebpackBundle: isWebpackBundle,
                content: content,
                issue: 'Large files (>100KB) cannot be parsed for API transformations',
            });

            onTransformed(false);
            return file;
        }

        // Apply transformations and check if AST was modified
        const { transformedAST, transformationCount } = applyApiTransformations(
            ast,
            mappings,
            file.path
        );

        if (transformationCount === 0) {
            onTransformed(false);
            return file;
        }

        // Generate code with preserved formatting and comments
        // Note: getContent() is called here only once per transformed file
        const originalContent = file.getContent();
        const newContent = FormatPreservingGenerator.generateWithPreservedFormatting(
            transformedAST,
            originalContent
        );
        onTransformed(true);

        return RenameAPIS.createTransformedFile(file, newContent);
    }

    /**
     * Creates a new LazyFile with transformed content.
     *
     * Creates an in-memory representation of the transformed file that
     * maintains the same interface as the original LazyFile but serves
     * the transformed content instead of reading from disk.
     *
     * @param originalFile Original file to base the transformation on
     * @param newContent Transformed JavaScript content
     * @returns New LazyFile instance with transformed content
     */
    private static createTransformedFile(originalFile: LazyFile, newContent: string): LazyFile {
        // Create new instance inheriting from LazyFile prototype
        const transformedFile = Object.create(LazyFile.prototype);

        // Copy basic properties
        transformedFile.path = originalFile.path;
        transformedFile.filetype = originalFile.filetype;
        transformedFile._transformedContent = newContent;
        // Copy absolute path so file can be updated later
        transformedFile._absolutePath = (originalFile as any)._absolutePath;

        // Override methods to work with transformed content
        transformedFile.getContent = () => newContent;
        transformedFile.getSize = () => Buffer.byteLength(newContent, 'utf8');
        transformedFile.close = () => {
            /* No-op for in-memory content */
        };

        // Override getAST to parse transformed content with error handling
        transformedFile.getAST = () => {
            try {
                // Try as script first (most common)
                return espree.parse(
                    newContent,
                    RenameAPIS.SCRIPT_PARSE_OPTIONS as any
                ) as ESTree.Program;
            } catch {
                try {
                    // Fallback to module parsing
                    return espree.parse(
                        newContent,
                        RenameAPIS.MODULE_PARSE_OPTIONS as any
                    ) as ESTree.Program;
                } catch (moduleError) {
                    logger.error(null, `Parsing Error`, {
                        path: originalFile.path,
                        error:
                            moduleError instanceof Error
                                ? moduleError.message
                                : String(moduleError),
                        contentSize: Buffer.byteLength(newContent, 'utf8'),
                    });
                    return undefined;
                }
            }
        };

        return transformedFile;
    }

    /**
     * @param startTime Migration start timestamp
     * @param extension Extension name for logging
     * @param processedFiles Number of JS files processed
     * @param transformedFiles Number of files actually transformed
     */
    private static logMigrationResults(
        startTime: number,
        extension: Extension | undefined,
        processedFiles: number,
        transformedFiles: number,
        blacklistedFiles: number = 0
    ): void {
        const duration = Date.now() - startTime;

        if (transformedFiles === 0) {
            if (blacklistedFiles > 0) {
                logger.info(extension, 'No API changes required', {
                    blacklistedFiles,
                    processedFiles,
                    duration,
                });
            } else {
                logger.info(extension, 'No API changes required');
            }
        } else {
            logger.info(extension, 'API rename migration completed', {
                transformedFiles,
                processedFiles,
                blacklistedFiles,
                duration,
            });
        }
    }

    /**
     * @param error The error that occurred
     * @param extension Extension name for logging
     * @param startTime Migration start timestamp
     */
    private static handleMigrationError(
        error: unknown,
        extension: Extension | undefined,
        startTime: number
    ): void {
        logger.error(extension, `Migration error at ${startTime}`, {
            error: error instanceof Error ? error.message : String(error),
        });
    }

    /**
     * Adds a tag to an extension if it doesn't already exist.
     * Utility method for consistent tag management across migration modules.
     *
     * @param extension Extension to add tag to
     * @param tag Tag enum value to add
     */
    private static addTagToExtension(extension: Extension, tag: Tags): void {
        if (!extension.tags) {
            extension.tags = [];
        }
        const tagValue = Tags[tag];
        if (!extension.tags.includes(tagValue)) {
            extension.tags.push(tagValue);
        }
    }
}
