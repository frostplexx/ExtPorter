import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import * as espree from 'espree';
import * as ESTree from 'estree';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { TwinningMapping } from '../types/twinning_mapping';
import { BlacklistChecker } from '../utils/blacklist_checker';
import { FormatPreservingGenerator } from '../utils/format_preserving_generator';

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
            const mappingsPath = path.join(__dirname, '../templates/api_mappings.json');
            logger.debug(null, 'Loading API mappings', { path: mappingsPath });

            const fileContent = fs.readFileSync(mappingsPath, 'utf8');
            api_mappings = JSON.parse(fileContent);

            logger.debug(null, 'API mappings cached', {
                count: api_mappings!.mappings.length,
            });
        } catch (error) {
            logger.error(null, 'Failed to load API mappings', {
                error: error instanceof Error ? error.message : String(error),
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
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            const mappings = RenameAPIS.loadApiMappings();

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

                // Check if file is blacklisted from transformation
                const blacklistResult = blacklistChecker.isFileBlacklisted(file.path);
                if (blacklistResult.isBlacklisted) {
                    blacklistedFiles++;
                    logger.debug(extension, 'File blacklisted from transformation', {
                        filePath: file.path,
                        reason: blacklistResult.reason,
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

            // Return new extension with transformed files
            return {
                ...extension,
                files: transformedFilesArray,
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
            // Enhanced error reporting for AST parsing failures
            const fileSize = file.getSize();
            const fileSizeKB = Math.round(fileSize / 1024);

            // Check if this could be a large file issue
            const isLargeFile = fileSize > 100000; // >100KB

            // Count potential API transformations that would have been applied
            const content = file.getContent();
            const potentialTransformations = RenameAPIS.countPotentialTransformations(
                content,
                mappings
            );

            if (isLargeFile && potentialTransformations > 0) {
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

                // Log user-visible warning
                console.warn(`⚠️  WARNING: API transformations skipped for ${file.path}`);
                console.warn(`   File size: ${fileSizeKB}KB (>100KB limit for AST parsing)`);
                console.warn(
                    `   ${potentialTransformations} potential API transformations were not applied`
                );
                console.warn(`   This may cause runtime errors in Manifest V3`);
            } else if (potentialTransformations > 0) {
                // Smaller file that failed to parse
                logger.error(null, 'AST parsing failed for file with API transformations needed', {
                    path: file.path,
                    fileSizeKB: fileSizeKB,
                    potentialTransformations: potentialTransformations,
                    issue: 'JavaScript syntax error or unsupported language features',
                });

                console.warn(`⚠️  WARNING: API transformations skipped for ${file.path}`);
                console.warn(`   File could not be parsed (${fileSizeKB}KB)`);
                console.warn(
                    `   ${potentialTransformations} potential API transformations were not applied`
                );
            } else {
                // File failed to parse but no APIs detected
                logger.debug(null, 'AST parsing failed but no API transformations needed', {
                    path: file.path,
                    fileSizeKB: fileSizeKB,
                });
            }

            onTransformed(false);
            return file;
        }

        // Apply transformations and check if AST was modified
        const { transformedAST, transformationCount } = RenameAPIS.applyApiTransformations(
            ast,
            mappings,
            file.path
        );

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
                    RenameAPIS.applyTargetTransformation(node, mapping.target, mapping.source);
                    transformationCount++;
                    break; // Only apply first matching transformation per node
                }
            }
        });

        if (transformationCount > 0) {
            logger.debug(null, 'API transformation summary', {
                file: filePath,
                transformationsApplied: transformationCount,
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
            // FIXME
            // if (!node.hasOwnProperty(key)) continue;

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
     * Also handles parameter restructuring for APIs that require it.
     *
     * @param node AST node to transform
     * @param target Target pattern from mapping
     * @param source Source pattern from mapping (needed for parameter transformation)
     */
    private static applyTargetTransformation(node: any, target: any, source?: any): void {
        const targetPattern = target.body.replace(/^return\s+/, '').replace(/;$/, '');

        if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
            // Transform function call member expression
            RenameAPIS.updateMemberExpressionPath(node.callee, targetPattern);

            // Handle parameter transformation if needed
            if (source && RenameAPIS.isParameterTransformationRequired(source, target)) {
                RenameAPIS.transformParameters(node);
            }
        } else if (node.type === 'MemberExpression') {
            // Transform property access member expression
            RenameAPIS.updateMemberExpressionPath(node, targetPattern);
        }
    }

    /**
     * Checks if parameter transformation is required based on source and target mappings.
     *
     * @param source Source mapping definition
     * @param target Target mapping definition
     * @returns True if parameters need to be restructured
     */
    private static isParameterTransformationRequired(source: any, target: any): boolean {
        // Check if parameter counts or structures differ
        const sourceFormals = source.formals || [];
        const targetFormals = target.formals || [];

        return (
            sourceFormals.length !== targetFormals.length ||
            JSON.stringify(sourceFormals) !== JSON.stringify(targetFormals)
        );
    }

    /**
     * Transforms function call parameters according to mapping rules.
     * Currently handles the chrome.tabs.executeScript -> chrome.scripting.executeScript transformation.
     *
     * @param callNode CallExpression AST node
     * @param source Source mapping definition
     * @param target Target mapping definition
     */
    private static transformParameters(callNode: any): void {
        const apiPath = RenameAPIS.buildMemberExpressionPath(callNode.callee);

        // Handle chrome.tabs.executeScript transformation specifically
        if (apiPath === 'chrome.scripting.executeScript') {
            RenameAPIS.transformExecuteScriptParameters(callNode);
        }

        // Future parameter transformations can be added here
        // else if (apiPath === 'chrome.other.api') {
        //     RenameAPIS.transformOtherApiParameters(callNode);
        // }
    }

    /**
     * Transforms chrome.tabs.executeScript parameters to chrome.scripting.executeScript format.
     *
     * MV2: chrome.tabs.executeScript(tabId, details, callback?)
     *      chrome.tabs.executeScript(details, callback?) // current tab
     * MV3: chrome.scripting.executeScript(injection, callback?)
     *
     * Where injection = { target: { tabId }, ...details }
     *
     * @param callNode CallExpression AST node for executeScript call
     */
    private static transformExecuteScriptParameters(callNode: any): void {
        const args = callNode.arguments;
        if (!args || args.length === 0) return;

        // Case 1: executeScript(tabId, details, callback?)
        // Detect: first arg is not an object (likely number/variable for tabId) and not null literal
        if (
            args.length >= 2 &&
            args[0].type !== 'ObjectExpression' &&
            !(args[0].type === 'Literal' && args[0].value === null)
        ) {
            const tabIdArg = args[0];
            const detailsArg = args[1];
            const callbackArg = args[2]; // Optional

            // Create injection object: { target: { tabId }, ...details }
            const injectionObject = RenameAPIS.createInjectionObject(tabIdArg, detailsArg);

            // Update arguments: [injection, callback?]
            callNode.arguments = [injectionObject];
            if (callbackArg) {
                callNode.arguments.push(callbackArg);
            }
        }
        // Case 2: executeScript(details, callback?) - no tabId means current tab
        // Detect: first arg is an object (details), optional second arg is callback
        else if (args.length >= 1 && args[0].type === 'ObjectExpression') {
            const detailsArg = args[0];
            const callbackArg = args[1]; // Optional

            // Check if details already has target property (already MV3 format)
            const hasTargetProperty = detailsArg.properties?.some(
                (prop: any) => prop.key?.name === 'target' || prop.key?.value === 'target'
            );

            if (!hasTargetProperty) {
                // Create injection object: { target: {}, ...details }
                const injectionObject = RenameAPIS.createInjectionObject(null, detailsArg);

                // Update arguments: [injection, callback?]
                callNode.arguments = [injectionObject];
                if (callbackArg) {
                    callNode.arguments.push(callbackArg);
                }
            }
            // If target property already exists, no transformation needed
        }
        // Case 3: executeScript(null, details, callback?) - explicit null tabId
        else if (args.length >= 2 && args[0].type === 'Literal' && args[0].value === null) {
            const detailsArg = args[1];
            const callbackArg = args[2]; // Optional

            // Treat null tabId as current tab
            const injectionObject = RenameAPIS.createInjectionObject(null, detailsArg);

            // Update arguments: [injection, callback?]
            callNode.arguments = [injectionObject];
            if (callbackArg) {
                callNode.arguments.push(callbackArg);
            }
        }
    }

    /**
     * Creates an injection object for chrome.scripting.executeScript.
     *
     * @param tabIdArg AST node for tabId (null for current tab)
     * @param detailsArg AST node for execution details
     * @returns ObjectExpression AST node for injection parameter
     */
    private static createInjectionObject(tabIdArg: any, detailsArg: any): any {
        const injectionObject = {
            type: 'ObjectExpression',
            properties: [] as any[],
        };

        // Add target property
        const targetProperty = {
            type: 'Property',
            method: false,
            shorthand: false,
            computed: false,
            key: {
                type: 'Identifier',
                name: 'target',
            },
            value: {
                type: 'ObjectExpression',
                properties: [] as any[],
            },
        };

        // Add tabId to target if provided
        if (tabIdArg !== null) {
            targetProperty.value.properties.push({
                type: 'Property',
                method: false,
                shorthand: false,
                computed: false,
                key: {
                    type: 'Identifier',
                    name: 'tabId',
                },
                value: tabIdArg,
            });
        }

        injectionObject.properties.push(targetProperty);

        // Add details properties
        if (detailsArg && detailsArg.type === 'ObjectExpression' && detailsArg.properties) {
            injectionObject.properties.push(...detailsArg.properties);
        } else if (detailsArg) {
            // If details is not an object literal, we can't spread it
            // Log a warning and keep the original structure
            logger.warn(
                null,
                'executeScript details parameter is not an object literal, skipping transformation',
                {
                    detailsType: detailsArg.type,
                }
            );
            return detailsArg; // Return original details as fallback
        }

        return injectionObject;
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
            current.object.name = newApiPath[0]; // chrome
            current.property.name = newApiPath[1]; // runtime
            memberExpr.property.name = newApiPath[2]; // connect
        } else if (newApiPath.length === 2) {
            current.object.name = newApiPath[0]; // chrome
            current.property.name = newApiPath[1]; // runtime
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

        const objectPath =
            memberExpr.object.type === 'MemberExpression'
                ? RenameAPIS.buildMemberExpressionPath(memberExpr.object)
                : memberExpr.object.name || '';

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
            } catch (error) {
                try {
                    logger.error(null, error as any)
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
     * Counts potential API transformations in file content using regex patterns.
     * Used to detect how many transformations would have been applied if AST parsing succeeded.
     *
     * @param content File content to analyze
     * @param mappings API transformation mappings
     * @returns Number of potential transformations
     */
    private static countPotentialTransformations(
        content: string,
        mappings: TwinningMapping
    ): number {
        let count = 0;

        for (const mapping of mappings.mappings) {
            // Extract API pattern from source mapping (remove return/semicolon)
            const sourcePattern = mapping.source.body.replace(/^return\s+/, '').replace(/;$/, '');

            // Create regex pattern to match API usage
            // Handle both function calls and property access
            const apiBase = sourcePattern.replace(/\([^)]*\)$/, ''); // Remove function call parens
            const escapedApi = apiBase.replace(/\./g, '\\.'); // Escape dots for regex

            // Match both property access and function calls
            const functionCallPattern = new RegExp(`\\b${escapedApi}\\s*\\(`, 'g');
            const propertyAccessPattern = new RegExp(`\\b${escapedApi}(?!\\w)`, 'g');

            const functionMatches = content.match(functionCallPattern) || [];
            const propertyMatches = content.match(propertyAccessPattern) || [];

            // Avoid double counting - if we have function calls, don't count property access
            count += functionMatches.length > 0 ? functionMatches.length : propertyMatches.length;
        }

        return count;
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
