import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import * as espree from 'espree';
import * as ESTree from 'estree';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { Tags } from '../types/tags';
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
    public static async migrate(extension: Extension): Promise<Extension | MigrationError> {
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
            const potentialTransformations = RenameAPIS.countPotentialTransformations(
                content,
                mappings
            );

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
        const { transformedAST, transformationCount } = RenameAPIS.applyApiTransformations(
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
        const contextMenuCalls: any[] = [];

        // traveerse the AST
        RenameAPIS.traverseAST(transformedAST, (node: any) => {
            // Special handling for window.open() in service workers
            if (RenameAPIS.isWindowOpenCall(node)) {
                RenameAPIS.transformWindowOpenToTabsCreate(node);
                transformationCount++;
            }

            // Special handling for contextMenus.create() with onclick
            if (RenameAPIS.isContextMenusCreateCall(node)) {
                const onclickProperty = RenameAPIS.extractOnclickFromContextMenu(node);
                if (onclickProperty) {
                    contextMenuCalls.push({ node, onclickProperty });
                    transformationCount++;
                }
            }

            // try each mapping until one matches (first-match wins)
            for (const mapping of mappings.mappings) {
                if (RenameAPIS.nodeMatchesSourcePattern(node, mapping.source)) {
                    RenameAPIS.applyTargetTransformation(node, mapping.target, mapping.source);
                    transformationCount++;
                    break; // Only apply first matching transformation per node
                }
            }
        });

        // Add contextMenus.onClicked listener after all other transformations
        if (contextMenuCalls.length > 0) {
            RenameAPIS.addContextMenusOnClickedListener(transformedAST, contextMenuCalls);
        }

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
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

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
                RenameAPIS.transformParameters(node, source);
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
     * Currently handles:
     * - chrome.tabs.executeScript -> chrome.scripting.executeScript
     * - chrome.tabs.getAllInWindow -> chrome.tabs.query
     * - chrome.tabs.getSelected -> chrome.tabs.query
     *
     * @param callNode CallExpression AST node
     * @param source Source pattern from mapping to determine which transformation to apply
     */
    private static transformParameters(callNode: any, source: any): void {
        const apiPath = RenameAPIS.buildMemberExpressionPath(callNode.callee);
        const sourcePattern = source.body.replace(/^return\s+/, '').replace(/;$/, '');

        // Handle chrome.tabs.executeScript transformation specifically
        if (apiPath === 'chrome.scripting.executeScript') {
            RenameAPIS.transformExecuteScriptParameters(callNode);
        }
        // Handle chrome.tabs.getAllInWindow -> chrome.tabs.query transformation
        else if (sourcePattern.startsWith('chrome.tabs.getAllInWindow(')) {
            RenameAPIS.transformGetAllInWindowParameters(callNode);
        }
        // Handle chrome.tabs.getSelected -> chrome.tabs.query transformation
        else if (sourcePattern.startsWith('chrome.tabs.getSelected(')) {
            RenameAPIS.transformGetSelectedParameters(callNode);
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
     * Transforms chrome.tabs.getAllInWindow parameters to chrome.tabs.query format.
     *
     * MV2: chrome.tabs.getAllInWindow(windowId, callback)
     *      - windowId can be null (current window) or a number
     * MV3: chrome.tabs.query(queryInfo, callback)
     *      - queryInfo is an object like {windowId: windowId} or {currentWindow: true}
     *
     * @param callNode CallExpression AST node for getAllInWindow call
     */
    private static transformGetAllInWindowParameters(callNode: any): void {
        const args = callNode.arguments;
        if (!args || args.length === 0) return;

        // Check if this is already in the correct format (has an object as first param)
        if (args[0].type === 'ObjectExpression') {
            // Already transformed or already in correct format
            return;
        }

        const windowIdArg = args[0];
        const callbackArg = args[1]; // Optional

        // Create queryInfo object
        let queryInfoObject: any;

        // Case 1: windowId is null -> use {currentWindow: true}
        if (windowIdArg.type === 'Literal' && windowIdArg.value === null) {
            queryInfoObject = {
                type: 'ObjectExpression',
                properties: [
                    {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                            type: 'Identifier',
                            name: 'currentWindow',
                        },
                        value: {
                            type: 'Literal',
                            value: true,
                        },
                    },
                ],
            };
        }
        // Case 2: windowId is a number or variable -> use {windowId: windowId}
        else {
            queryInfoObject = {
                type: 'ObjectExpression',
                properties: [
                    {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                            type: 'Identifier',
                            name: 'windowId',
                        },
                        value: windowIdArg,
                    },
                ],
            };
        }

        // Update arguments: [queryInfo, callback?]
        callNode.arguments = [queryInfoObject];
        if (callbackArg) {
            callNode.arguments.push(callbackArg);
        }
    }

    /**
     * Transforms chrome.tabs.getSelected parameters to chrome.tabs.query format.
     *
     * MV2: chrome.tabs.getSelected(windowId, callback)
     *      - windowId can be null (current window) or a number
     * MV3: chrome.tabs.query({active: true, windowId: windowId}, callback)
     *      - Always includes active: true to get the selected (active) tab
     *
     * @param callNode CallExpression AST node for getSelected call
     */
    private static transformGetSelectedParameters(callNode: any): void {
        const args = callNode.arguments;
        if (!args || args.length === 0) return;

        // Check if this is already in the correct format (has an object as first param)
        if (args[0].type === 'ObjectExpression') {
            // Already transformed or already in correct format
            return;
        }

        const windowIdArg = args[0];
        const callbackArg = args[1]; // Optional

        // Create queryInfo object with active: true
        let queryInfoObject: any;

        // Case 1: windowId is null -> use {active: true, currentWindow: true}
        if (windowIdArg.type === 'Literal' && windowIdArg.value === null) {
            queryInfoObject = {
                type: 'ObjectExpression',
                properties: [
                    {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                            type: 'Identifier',
                            name: 'active',
                        },
                        value: {
                            type: 'Literal',
                            value: true,
                        },
                    },
                    {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                            type: 'Identifier',
                            name: 'currentWindow',
                        },
                        value: {
                            type: 'Literal',
                            value: true,
                        },
                    },
                ],
            };
        }
        // Case 2: windowId is a number or variable -> use {active: true, windowId: windowId}
        else {
            queryInfoObject = {
                type: 'ObjectExpression',
                properties: [
                    {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                            type: 'Identifier',
                            name: 'active',
                        },
                        value: {
                            type: 'Literal',
                            value: true,
                        },
                    },
                    {
                        type: 'Property',
                        method: false,
                        shorthand: false,
                        computed: false,
                        key: {
                            type: 'Identifier',
                            name: 'windowId',
                        },
                        value: windowIdArg,
                    },
                ],
            };
        }

        // Update arguments: [queryInfo, callback?]
        callNode.arguments = [queryInfoObject];
        if (callbackArg) {
            callNode.arguments.push(callbackArg);
        }
    }

    /**
     * Checks if an AST node is a window.open() call.
     *
     * @param node AST node to check
     * @returns True if node is a window.open() call
     */
    private static isWindowOpenCall(node: any): boolean {
        if (node.type !== 'CallExpression') return false;
        
        // Check for window.open()
        if (node.callee?.type === 'MemberExpression') {
            const apiPath = RenameAPIS.buildMemberExpressionPath(node.callee);
            return apiPath === 'window.open';
        }
        
        return false;
    }

    /**
     * Transforms window.open() to chrome.tabs.create() for service worker compatibility.
     *
     * MV2 background page: window.open(url, target?, features?)
     * MV3 service worker: chrome.tabs.create({ url: url })
     *
     * Service workers don't have access to the window object, so window.open() must
     * be replaced with chrome.tabs.create() to open new tabs.
     *
     * @param node CallExpression AST node for window.open() call
     */
    private static transformWindowOpenToTabsCreate(node: any): void {
        const args = node.arguments;
        if (!args || args.length === 0) return;

        // Get the URL argument (first parameter)
        const urlArg = args[0];

        // Create chrome.tabs.create({ url: urlArg })
        node.callee = {
            type: 'MemberExpression',
            object: {
                type: 'MemberExpression',
                object: {
                    type: 'Identifier',
                    name: 'chrome',
                },
                property: {
                    type: 'Identifier',
                    name: 'tabs',
                },
                computed: false,
            },
            property: {
                type: 'Identifier',
                name: 'create',
            },
            computed: false,
        };

        // Create the options object with url property
        const optionsObject = {
            type: 'ObjectExpression',
            properties: [
                {
                    type: 'Property',
                    method: false,
                    shorthand: false,
                    computed: false,
                    key: {
                        type: 'Identifier',
                        name: 'url',
                    },
                    value: urlArg,
                    kind: 'init',
                },
            ],
        };

        // Replace arguments with the options object
        node.arguments = [optionsObject];

        logger.debug(null, 'Transformed window.open() to chrome.tabs.create()');
    }

    /**
     * Checks if an AST node is a chrome.contextMenus.create() call.
     *
     * @param node AST node to check
     * @returns True if node is a contextMenus.create() call
     */
    private static isContextMenusCreateCall(node: any): boolean {
        if (node.type !== 'CallExpression' || !node.callee?.type) return false;
        
        const apiPath = RenameAPIS.buildMemberExpressionPath(node.callee);
        return apiPath === 'chrome.contextMenus.create';
    }

    /**
     * Extracts and removes the onclick property from a contextMenus.create() call.
     * Returns the onclick function and the menu item ID (if present), and removes
     * the onclick property from the call.
     *
     * @param node CallExpression AST node for contextMenus.create()
     * @returns Object with onclick function and menu ID, or null if no onclick found
     */
    private static extractOnclickFromContextMenu(node: any): { onclick: any; menuId: any } | null {
        if (!node.arguments || node.arguments.length === 0) return null;
        
        const firstArg = node.arguments[0];
        if (firstArg.type !== 'ObjectExpression') return null;

        // Find onclick and id properties
        let onclickProperty: any = null;
        let idProperty: any = null;
        let idPropertyNode: any = null;
        const remainingProperties: any[] = [];

        for (const prop of firstArg.properties) {
            const keyName = prop.key?.name || prop.key?.value;
            
            if (keyName === 'onclick') {
                onclickProperty = prop.value;
            } else if (keyName === 'id') {
                idProperty = prop.value;
                idPropertyNode = prop; // Keep the full property node
                remainingProperties.push(prop); // Keep id in the object
            } else {
                remainingProperties.push(prop);
            }
        }

        if (!onclickProperty) return null;

        // If no id property exists, generate one
        if (!idProperty) {
            // Generate a unique ID based on title or index
            const titleProp = remainingProperties.find(
                (p) => (p.key?.name || p.key?.value) === 'title'
            );
            
            if (titleProp && titleProp.value.type === 'Literal') {
                // Use title as base for ID
                const titleValue = String(titleProp.value.value).toLowerCase().replace(/\s+/g, '-');
                idProperty = {
                    type: 'Literal',
                    value: `context-menu-${titleValue}`,
                };
            } else {
                // Use generic ID
                idProperty = {
                    type: 'Literal',
                    value: `context-menu-${Date.now()}`,
                };
            }

            // Add id property to the remaining properties
            idPropertyNode = {
                type: 'Property',
                method: false,
                shorthand: false,
                computed: false,
                key: {
                    type: 'Identifier',
                    name: 'id',
                },
                value: idProperty,
                kind: 'init',
            };
            remainingProperties.push(idPropertyNode);
        }

        // Remove onclick from the object and keep remaining properties (including id)
        firstArg.properties = remainingProperties;

        return {
            onclick: onclickProperty,
            menuId: idProperty,
        };
    }

    /**
     * Adds chrome.contextMenus.onClicked.addListener() at the end of the program
     * to handle all context menu clicks that were previously using onclick.
     *
     * @param ast The transformed AST
     * @param contextMenuCalls Array of context menu calls with their onclick handlers
     */
    private static addContextMenusOnClickedListener(ast: any, contextMenuCalls: any[]): void {
        if (!ast.body || !Array.isArray(ast.body)) return;

        // Build the listener function
        const listenerFunction: any = {
            type: 'ExpressionStatement',
            expression: {
                type: 'CallExpression',
                callee: {
                    type: 'MemberExpression',
                    object: {
                        type: 'MemberExpression',
                        object: {
                            type: 'MemberExpression',
                            object: {
                                type: 'Identifier',
                                name: 'chrome',
                            },
                            property: {
                                type: 'Identifier',
                                name: 'contextMenus',
                            },
                            computed: false,
                        },
                        property: {
                            type: 'Identifier',
                            name: 'onClicked',
                        },
                        computed: false,
                    },
                    property: {
                        type: 'Identifier',
                        name: 'addListener',
                    },
                    computed: false,
                },
                arguments: [
                    {
                        type: 'FunctionExpression',
                        id: null,
                        params: [
                            {
                                type: 'Identifier',
                                name: 'info',
                            },
                            {
                                type: 'Identifier',
                                name: 'tab',
                            },
                        ],
                        body: {
                            type: 'BlockStatement',
                            body: [],
                        },
                        generator: false,
                        async: false,
                    },
                ],
            },
        };

        // Build if-else chain for handling each menu item
        const listenerBody = listenerFunction.expression.arguments[0].body.body;
        
        for (let i = 0; i < contextMenuCalls.length; i++) {
            const { onclick, menuId } = contextMenuCalls[i].onclickProperty;
            
            // Create if statement: if (info.menuItemId === 'menu-id')
            const condition: any = {
                type: 'BinaryExpression',
                operator: '===',
                left: {
                    type: 'MemberExpression',
                    object: {
                        type: 'Identifier',
                        name: 'info',
                    },
                    property: {
                        type: 'Identifier',
                        name: 'menuItemId',
                    },
                    computed: false,
                },
                right: menuId,
            };

            // Create the function call statement
            let consequent: any;
            if (onclick.type === 'FunctionExpression' || onclick.type === 'ArrowFunctionExpression') {
                // Inline function - call it
                consequent = {
                    type: 'BlockStatement',
                    body: [
                        {
                            type: 'ExpressionStatement',
                            expression: {
                                type: 'CallExpression',
                                callee: {
                                    type: 'FunctionExpression',
                                    id: null,
                                    params: onclick.params || [],
                                    body: onclick.body,
                                    generator: false,
                                    async: false,
                                },
                                arguments: [
                                    {
                                        type: 'Identifier',
                                        name: 'info',
                                    },
                                    {
                                        type: 'Identifier',
                                        name: 'tab',
                                    },
                                ],
                            },
                        },
                    ],
                };
            } else if (onclick.type === 'Identifier') {
                // Named function reference - call it
                consequent = {
                    type: 'BlockStatement',
                    body: [
                        {
                            type: 'ExpressionStatement',
                            expression: {
                                type: 'CallExpression',
                                callee: onclick,
                                arguments: [
                                    {
                                        type: 'Identifier',
                                        name: 'info',
                                    },
                                    {
                                        type: 'Identifier',
                                        name: 'tab',
                                    },
                                ],
                            },
                        },
                    ],
                };
            } else {
                // Unknown type, skip
                continue;
            }

            const ifStatement: any = {
                type: 'IfStatement',
                test: condition,
                consequent: consequent,
                alternate: null,
            };

            listenerBody.push(ifStatement);
        }

        // Add the listener to the end of the program
        ast.body.push(listenerFunction);

        logger.debug(null, 'Added contextMenus.onClicked listener', {
            menuItemsHandled: contextMenuCalls.length,
        });
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
                blacklistedFiles,
                guidance: 'webpack-specific migration workflow recommended',
            });

            const guidanceMessages = [
                '',
                '📦 WEBPACK EXTENSION DETECTED',
                '═══════════════════════════════════════════════════',
                'This extension appears to use webpack for bundling.',
                'For optimal Manifest V3 migration:',
                '',
                '🔄 RECOMMENDED WORKFLOW:',
                '  1. Migrate source files BEFORE webpack bundling',
                '  2. Update webpack config for Manifest V3:',
                '     • Set service worker as single entry point',
                '     • Configure proper output for content scripts',
                '     • Update any chrome.* API references',
                '  3. Re-bundle with updated webpack config',
                '',
                '⚙️  WEBPACK V3 CONSIDERATIONS:',
                '  • Background scripts → Service worker (single file)',
                '  • Update CSP for stricter V3 requirements',
                '  • Remove dynamic eval() and similar patterns',
                '  • Test hot reload and development workflows',
                '',
                '📚 RESOURCES:',
                '  • Chrome MV3 Migration Guide: https://developer.chrome.com/docs/extensions/develop/migrate',
                '  • Webpack Chrome Extension Templates: Search for "webpack chrome extension manifest v3"',
                '',
                `${blacklistedFiles} bundled files were skipped during migration.`,
                '═══════════════════════════════════════════════════',
                '',
            ];

            // Log guidance messages as user-visible info
            guidanceMessages.forEach((message) => {
                logger.info(extension, message);
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
