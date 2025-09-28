import { Extension } from "../types/extension";
import { MigrationError, MigrationModule } from "../types/migration_module";
import { LazyFile } from "../types/abstract_file";
import { ExtFileType } from "../types/ext_file_types";
import * as espree from "espree";
import * as ESTree from "estree";
import * as escodegen from "escodegen";
import * as fs from "fs";
import * as path from "path";
import { logger } from "../utils/logger";
import { TwinningMapping } from "../types/twinning_mapping";
import { BlacklistChecker } from "../utils/blacklist_checker";
import { FormatPreservingGenerator } from "../utils/format_preserving_generator";

/**
 * Cached API mappings
 */
let api_mappings: TwinningMapping | null = null;

/**
 * This module handles the transformation of Chrome Extension Manifest V2 APIs 
 * to their Manifest V3 equivalents using AST-based transformations.
 */
export class RenameAPIS implements MigrationModule {

    /**
     * Loads API mappings from the configuration file and writes them into api_mappings
     * @returns The loaded twinning mappings or empty mappings on error
     */
    private static loadApiMappings(): TwinningMapping {
        if (api_mappings !== null) {
            return api_mappings;
        }

        try {
            const mappingsPath = path.join(__dirname, "../templates/api_mappings.json");
            logger.debug(null, "Loading API mappings", { path: mappingsPath });

            const fileContent = fs.readFileSync(mappingsPath, "utf8");
            api_mappings = JSON.parse(fileContent);

            logger.debug(null, "API mappings cached", {
                count: api_mappings!.mappings.length
            });
        } catch (error) {
            logger.error(null, "Failed to load API mappings", {
                error: error instanceof Error ? error.message : String(error)
            });
            // Fallback to empty mappings to prevent crashes
            api_mappings = { mappings: [] };
        }

        // At this point cachedApiMappings is guaranteed to not be null
        return api_mappings!;
    }

    /**
     * Processes all JavaScript files in the extension and 
     * applies API transformations based on the loaded mapping rules.
     */
    public static migrate(extension: Extension): Extension | MigrationError {
        const startTime = Date.now();
        // logger.info(extension, "Starting API rename migration");

        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error("Invalid extension structure"));
            }

            const mappings = RenameAPIS.loadApiMappings();

            // return if no mappings available
            if (mappings.mappings.length === 0) {
                return new MigrationError(extension, new Error("No API mappings available"));
            }

            let hasChanges = false;
            let processedFiles = 0;
            let transformedFiles = 0;
            let blacklistedFiles = 0;

            const blacklistChecker = BlacklistChecker.getInstance();

            const transformedFilesArray = extension.files.map(file => {
                // skip files that arent js
                if (file.filetype !== ExtFileType.JS) {
                    return file;
                }

                // Check if file is blacklisted from transformation
                const blacklistResult = blacklistChecker.isFileBlacklisted(file.path);
                if (blacklistResult.isBlacklisted) {
                    blacklistedFiles++;
                    logger.debug(extension, "File blacklisted from transformation", {
                        filePath: file.path,
                        reason: blacklistResult.reason
                    });
                    return file; // Return original file without transformation
                }

                processedFiles++;
                return RenameAPIS.processJavaScriptFile(file, mappings, (transformed) => {
                    if (transformed) {
                        hasChanges = true;
                        transformedFiles++;
                    }
                });
            });

            RenameAPIS.logMigrationResults(startTime, extension, processedFiles, transformedFiles, blacklistedFiles);

            // Return original extension if no changes were made
            if (!hasChanges) {
                return extension;
            }

            // Return new extension with transformed files
            return {
                ...extension,
                files: transformedFilesArray
            };

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
     * @param onTransformed Callback to track if transformation occurred
     * @returns Original file or transformed file
     */
    private static processJavaScriptFile(
        file: LazyFile,
        mappings: TwinningMapping,
        onTransformed: (transformed: boolean) => void
    ): LazyFile {

        const ast = file.getAST();
        if (!ast) {
            logger.error(null, "No AST available", { "path": file.path });
            onTransformed(false);
            return file;
        }

        // Apply transformations and check if AST was modified
        const { transformedAST, transformationCount } = RenameAPIS.applyApiTransformations(ast, mappings, file.path);

        if (transformationCount === 0) {
            // logger.warn(null, "No Transformations applied", {
            //     path: file.path,
            //     mappings: mappings
            // })
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
     * Applies API transformations to an AST.
     * 
     * @param ast The AST to transform
     * @param mappings API transformation mappings
     * @param filePath File path for logging
     * @returns Object with transformed AST and transformation count
     */
    private static applyApiTransformations(
        ast: ESTree.Node,
        mappings: TwinningMapping,
        filePath: string
    ): { transformedAST: ESTree.Node; transformationCount: number } {
        // clone AST to avoid modifying original
        // stringifing and parsing the ast is really the way youre supposed to do it:
        // https://dev.to/fpaghar/copy-objects-ways-in-javascript-24gj
        const transformedAST = JSON.parse(JSON.stringify(ast));
        let transformationCount = 0;

        // traveerse the AST
        RenameAPIS.traverseAST(transformedAST, (node: any) => {
            // try each mapping until one matches (first-match wins)
            for (const mapping of mappings.mappings) {
                if (RenameAPIS.nodeMatchesSourcePattern(node, mapping.source)) {
                    RenameAPIS.applyTargetTransformation(node, mapping.target);
                    transformationCount++;
                    break; // Only apply first matching transformation per node
                }
            }
        });

        if (transformationCount > 0) {
            logger.debug(null, "API transformation summary", {
                file: filePath,
                transformationsApplied: transformationCount
            });
        }

        return { transformedAST, transformationCount };
    }

    /**
     * Uses a visitor pattern (https://refactoring.guru/design-patterns/visitor) to traverse the AST once
     * 
     * @param node Current AST node
     * @param visitor Function to call for each node
     */
    private static traverseAST(node: any, visitor: (node: any) => void): void {
        // Early return for null/undefined/primitive values
        if (!node || typeof node !== 'object') {
            return;
        }

        // Visit current node
        visitor(node);

        // Traverse all object properties and arrays
        for (const key in node) {
            if (!node.hasOwnProperty(key)) continue;

            const value = node[key];
            if (Array.isArray(value)) {
                // Traverse array elements
                for (const item of value) {
                    RenameAPIS.traverseAST(item, visitor);
                }
            } else if (typeof value === 'object') {
                // Traverse nested objects
                RenameAPIS.traverseAST(value, visitor);
            }
        }
    }

    /**
     * Checks if an AST node matches a source pattern for transformation.
     * 
     * Handles two main patterns:
     * 1. Function calls: chrome.extension.connect() -> CallExpression
     * 2. Property access: chrome.extension.onConnect -> MemberExpression
     * 
     * @param node AST node to check
     * @param source Source pattern from mapping
     * @returns True if node matches the pattern
     */
    private static nodeMatchesSourcePattern(node: any, source: any): boolean {
        // Extract clean API pattern from source (remove return/semicolon)
        const sourcePattern = source.body.replace(/^return\s+/, '').replace(/;$/, '');

        // Match function calls (e.g., chrome.extension.connect())
        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
            const apiPath = RenameAPIS.buildMemberExpressionPath(node.callee);
            return sourcePattern === apiPath || sourcePattern.startsWith(apiPath + '(');
        }

        // Match property access (e.g., chrome.extension.onConnect)
        if (node.type === 'MemberExpression') {
            const apiPath = RenameAPIS.buildMemberExpressionPath(node);
            return sourcePattern === apiPath;
        }

        return false;
    }

    /**
     * Applies a target transformation to an AST node.
     * 
     * Modifies the node in-place to change the API path according to
     * the target pattern (e.g., chrome.extension -> chrome.runtime).
     * 
     * @param node AST node to transform
     * @param target Target pattern from mapping
     */
    private static applyTargetTransformation(node: any, target: any): void {
        const targetPattern = target.body.replace(/^return\s+/, '').replace(/;$/, '');

        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
            // Transform function call member expression
            RenameAPIS.updateMemberExpressionPath(node.callee, targetPattern);
        } else if (node.type === 'MemberExpression') {
            // Transform property access member expression
            RenameAPIS.updateMemberExpressionPath(node, targetPattern);
        }
    }

    /**
     * Updates a member expression with a new API path.
     * 
     * Parses the target pattern to extract the new API path and updates
     * the AST node structure accordingly. Handles nested member expressions
     * like chrome.runtime.connect.
     * 
     * @param memberExpr Member expression AST node to update
     * @param targetPattern Target API pattern (e.g., "chrome.runtime.connect()")
     */
    private static updateMemberExpressionPath(memberExpr: any, targetPattern: string): void {
        // Extract API path from target pattern (everything before parentheses or end)
        const apiMatch = targetPattern.match(/^([a-zA-Z.]+)/);
        if (!apiMatch) return;

        const newApiPath = apiMatch[1].split('.');
        if (newApiPath.length < 2) return;

        // Navigate to the root of the member expression chain
        let current = memberExpr;
        while (current.object?.type === 'MemberExpression') {
            current = current.object;
        }

        // Update the API path components
        // For chrome.runtime.connect: chrome(root) -> runtime(middle) -> connect(leaf)
        if (newApiPath.length >= 3) {
            current.object.name = newApiPath[0];     // chrome
            current.property.name = newApiPath[1];   // runtime
            memberExpr.property.name = newApiPath[2]; // connect
        } else if (newApiPath.length === 2) {
            current.object.name = newApiPath[0];     // chrome
            current.property.name = newApiPath[1];   // runtime
        }
    }

    /**
     * Builds a string representation of a member expression.
     * 
     * Recursively constructs the full API path from nested member expressions.
     * Example: chrome.extension.connect -> "chrome.extension.connect"
     * 
     * @param memberExpr Member expression AST node
     * @returns String representation of the API path
     */
    private static buildMemberExpressionPath(memberExpr: any): string {
        if (memberExpr.type !== 'MemberExpression') {
            return '';
        }

        const objectPath = memberExpr.object.type === 'MemberExpression'
            ? RenameAPIS.buildMemberExpressionPath(memberExpr.object)
            : (memberExpr.object.name || '');

        const propertyName = memberExpr.property.name || '';

        return objectPath ? `${objectPath}.${propertyName}` : propertyName;
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

        // Override methods to work with transformed content
        transformedFile.getContent = () => newContent;
        transformedFile.getSize = () => Buffer.byteLength(newContent, 'utf8');
        transformedFile.close = () => { /* No-op for in-memory content */ };

        // Override getAST to parse transformed content with error handling
        transformedFile.getAST = () => {
            try {
                // Try as script first (most common)
                return espree.parse(newContent, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true
                } as any) as ESTree.Program;
            } catch (error) {
                try {
                    // Fallback to module parsing
                    return espree.parse(newContent, {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        loc: true,
                        range: true
                    } as any) as ESTree.Program;
                } catch (moduleError) {
                    logger.error(null, `Parsing Error`, {
                        "path": originalFile.path,
                        "error": (moduleError instanceof Error ? moduleError.message : String(moduleError)),
                        "message": Buffer.byteLength(newContent, 'utf8')
                    })
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
                logger.info(extension, "No API changes required", {
                    blacklistedFiles,
                    processedFiles,
                    duration
                });
            } else {
                logger.info(extension, "No API changes required");
            }
        } else {
            logger.info(extension, "API rename migration completed", {
                transformedFiles,
                processedFiles,
                blacklistedFiles,
                duration
            });
        }
    }

    /**
     * @param error The error that occurred
     * @param extension Extension name for logging
     * @param startTime Migration start timestamp
     */
    private static handleMigrationError(error: unknown, extension: Extension | undefined, startTime: number): void {
        logger.error(extension, `Migration error at ${startTime}`, {
            "error": error instanceof Error ? error.message : String(error)
        });
    }
}
