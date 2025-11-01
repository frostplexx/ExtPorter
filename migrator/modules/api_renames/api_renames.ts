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
import { loadApiMappings, countPotentialTransformations } from './api-mappings-loader';
import { applyApiTransformations } from './ast-transformers';

/**
 * This module handles the transformation of Chrome Extension Manifest V2 APIs
 * to their Manifest V3 equivalents using AST-based transformations.
 */
export class RenameAPIS implements MigrationModule {

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

            const mappings = loadApiMappings();

            // return if no mappings available
            if (mappings.mappings.length === 0) {
                return new MigrationError(extension, new Error('No API mappings available'));
            }

            let hasChanges = false;
            let processedFiles = 0;
            let transformedFiles = 0;
            let blacklistedFiles = 0;

            const blacklistChecker = BlacklistChecker.getInstance();

            const transformedFilesArray = extension.files.map((file) => {
                // skip files that arent js
                if (file.filetype !== ExtFileType.JS) {
                    return file;
                }

                // Check if file is blacklisted from transformation (with content signature detection)
                const fileContent = file.getContent();
                const blacklistResult = blacklistChecker.isFileBlacklisted(file.path, fileContent);
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
            if (!updatedExtension.tags) {
                updatedExtension.tags = [];
            }
            const apiRenameTag = Tags[Tags.API_RENAMES_APPLIED];
            if (!updatedExtension.tags.includes(apiRenameTag)) {
                updatedExtension.tags.push(apiRenameTag);
            }

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
            // Enhanced error reporting for AST parsing failures
            const fileSize = file.getSize();
            const fileSizeKB = Math.round(fileSize / 1024);

            // Check if this could be a large file issue
            const isLargeFile = fileSize > 100000; // >100KB

            // Count potential API transformations that would have been applied
            const content = file.getContent();
            const potentialTransformations = countPotentialTransformations(content, mappings);

            // Check if this is a webpack bundle
            const isWebpackBundle =
                content.includes('__webpack_require__') ||
                content.includes('webpackChunk') ||
                /\(\d+,\s*function\s*\(\s*\w+,\s*\w+,\s*\w+\s*\)/.test(content.substring(0, 10000));

            if (isLargeFile && potentialTransformations > 0) {
                if (isWebpackBundle) {
                    // This is a critical issue - large file with APIs that need transformation
                    logger.error(
                        null,
                        'AST parsing failed for large file with API transformations needed',
                        {
                            path: file.path,
                            fileSizeKB: fileSizeKB,
                            potentialTransformations: potentialTransformations,
                            issue: 'Large files (>100KB) cannot be parsed for API transformations',
                        }
                    );

                    // Enhanced user-visible warning for webpack bundles
                    logger.warn(
                        extension,
                        'Webpack bundle detected with API transformations needed',
                        {
                            path: file.path,
                            fileSizeKB: fileSizeKB,
                            potentialTransformations: potentialTransformations,
                            solutions: [
                                'Use development/unminified build for migration',
                                'Migrate source files before webpack bundling',
                                'Manual migration may be required',
                            ],
                        }
                    );
                } else {
                    // Large non-webpack file with APIs that need transformation
                    logger.error(
                        null,
                        'AST parsing failed for large file with API transformations needed',
                        {
                            path: file.path,
                            fileSizeKB: fileSizeKB,
                            potentialTransformations: potentialTransformations,
                            issue: 'Large files (>100KB) cannot be parsed for API transformations',
                        }
                    );

                    // Log user-visible warning
                    logger.warn(
                        extension,
                        'Large file API transformations skipped - may cause MV3 runtime errors',
                        {
                            path: file.path,
                            fileSizeKB: fileSizeKB,
                            potentialTransformations: potentialTransformations,
                            issue: 'File exceeds 100KB AST parsing limit',
                            impact: 'May cause runtime errors in Manifest V3',
                        }
                    );
                }
            } else if (potentialTransformations > 0) {
                // Smaller webpack bundle that failed to parse
                logger.error(null, 'Webpack bundle detected with API transformations needed', {
                    path: file.path,
                    fileSizeKB: fileSizeKB,
                    potentialTransformations: potentialTransformations,
                    issue: 'Webpack bundles cannot be automatically migrated',
                });
            } else {
                // File failed to parse but no APIs detected
                if (isWebpackBundle) {
                    logger.debug(
                        null,
                        'Webpack bundle detected but no API transformations needed',
                        {
                            path: file.path,
                            fileSizeKB: fileSizeKB,
                            bundleType: 'webpack',
                        }
                    );
                } else {
                    logger.debug(null, 'AST parsing failed but no API transformations needed', {
                        path: file.path,
                        fileSizeKB: fileSizeKB,
                    });
                }
            }

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
                return espree.parse(newContent, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true,
                } as any) as ESTree.Program;
            } catch {
                try {
                    // Fallback to module parsing
                    return espree.parse(newContent, {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        loc: true,
                        range: true,
                    } as any) as ESTree.Program;
                } catch (moduleError) {
                    logger.error(null, `Parsing Error`, {
                        path: originalFile.path,
                        error:
                            moduleError instanceof Error
                                ? moduleError.message
                                : String(moduleError),
                        message: Buffer.byteLength(newContent, 'utf8'),
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

                // Check if blacklisted files include webpack bundles and provide guidance
                RenameAPIS.logWebpackGuidance(extension, blacklistedFiles);
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

            if (blacklistedFiles > 0) {
                RenameAPIS.logWebpackGuidance(extension, blacklistedFiles);
            }
        }
    }

    /**
     * Provides user guidance for webpack-based extensions
     */
    private static logWebpackGuidance(
        extension: Extension | undefined,
        blacklistedFiles: number
    ): void {
        // Check if any blacklisted files are likely webpack bundles
        const hasWebpackFiles = extension?.files?.some((file) => {
            if (file.filetype !== ExtFileType.JS) return false;
            const content = file.getContent();
            return (
                content.includes('__webpack_require__') ||
                content.includes('webpackChunk') ||
                file.path.includes('bundle') ||
                file.path.includes('webpack')
            );
        });

        if (hasWebpackFiles) {
            logger.info(extension, 'Webpack extension detected - providing migration guidance', {
                blacklistedFiles
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
}
