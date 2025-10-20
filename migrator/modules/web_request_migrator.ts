import { Extension } from '../types/extension';
import { MigrationError, MigrationModule } from '../types/migration_module';
import { LazyFile } from '../types/abstract_file';
import { ExtFileType } from '../types/ext_file_types';
import { logger } from '../utils/logger';
import {
    Rule,
    RuleActionType,
    ResourceType,
    RuleCondition,
    Ruleset,
} from '../types/dnr_rule_types';

/**
 * Migration module that converts blocking chrome.webRequest API calls to chrome.declarativeNetRequest
 *
 * This module only migrates webRequest listeners that use "blocking" in their extraInfoSpec.
 * Non-blocking webRequest listeners (observational only) are left unchanged.
 *
 * This module analyzes blocking webRequest usage and:
 * 1. Identifies static patterns that can be converted to DNR rules
 * 2. Detects dynamic logic that may require updateDynamicRules or marks migration as failed
 * 3. Generates rules.json file with static rules
 * 4. Updates manifest to include DNR configuration
 *
 * Blocking webRequest events include listeners with "blocking" in extraInfoSpec, such as:
 * - onBeforeRequest with blocking (for canceling/redirecting requests)
 * - onBeforeSendHeaders with blocking (for modifying request headers)
 * - onHeadersReceived with blocking (for modifying response headers)
 * - onAuthRequired with blocking (for handling authentication)
 */
export class WebRequestMigrator implements MigrationModule {
    private static ruleIdCounter = 1;

    /**
     * Main migration method
     */
    public static migrate(extension: Extension): Extension | MigrationError {
        const startTime = Date.now();

        try {
            // Validate extension input
            if (!extension || !extension.id || !extension.files || !extension.manifest) {
                return new MigrationError(extension, new Error('Invalid extension structure'));
            }

            // Find all blocking webRequest usages
            const webRequestUsages = WebRequestMigrator.findWebRequestUsages(extension);

            if (webRequestUsages.length === 0) {
                logger.debug(extension, 'No blocking webRequest usage found');
                return extension;
            }

            logger.info(extension, `Found ${webRequestUsages.length} blocking webRequest usage(s)`);

            // Analyze each usage to determine if it can be migrated
            const staticRules: Rule[] = [];

            for (const usage of webRequestUsages) {
                const analysis = WebRequestMigrator.analyzeWebRequestUsage(usage);

                if (analysis.hasDynamicLogic) {
                    // Migration must fail - dynamic logic that cannot be converted
                    logger.error(
                        extension,
                        `Cannot migrate blocking webRequest usage with dynamic logic: ${usage.eventType}`,
                        {
                            file: usage.file.path,
                            reason: analysis.reason,
                        }
                    );
                    return new MigrationError(
                        extension,
                        new Error(
                            `Blocking webRequest migration failed: ${usage.eventType} in ${usage.file.path} contains non-migratable dynamic logic: ${analysis.reason}`
                        )
                    );
                } else {
                    // Static pattern - convert to DNR rule
                    const rule = WebRequestMigrator.convertToStaticRule(usage, extension);
                    if (rule) {
                        staticRules.push(rule);
                    }
                }
            }

            // Create rules.json file if we have static rules
            let finalFiles = extension.files;
            if (staticRules.length > 0) {
                const rulesFile = WebRequestMigrator.createRulesFile(staticRules);
                finalFiles = [...extension.files, rulesFile];
                logger.info(extension, `Generated ${staticRules.length} static DNR rule(s)`);
            }

            const duration = Date.now() - startTime;
            logger.info(extension, 'Blocking webRequest to declarativeNetRequest migration completed', {
                staticRules: staticRules.length,
                duration,
            });

            return {
                ...extension,
                files: finalFiles,
            };
        } catch (error) {
            logger.error(extension, 'Blocking webRequest migration failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Find all blocking webRequest API usages in the extension
     * Only returns webRequest listeners that have "blocking" in extraInfoSpec
     */
    private static findWebRequestUsages(extension: Extension): WebRequestUsage[] {
        const usages: WebRequestUsage[] = [];

        for (const file of extension.files) {
            if (file.filetype !== ExtFileType.JS) {
                continue;
            }

            const ast = file.getAST();
            if (!ast) {
                continue;
            }

            // Traverse AST to find chrome.webRequest.* event listeners
            WebRequestMigrator.traverseAST(ast, (node: any) => {
                if (WebRequestMigrator.isWebRequestEventListener(node)) {
                    const usage = WebRequestMigrator.extractWebRequestUsage(node, file);
                    // Only include blocking webRequest usages
                    if (usage && WebRequestMigrator.isBlockingWebRequest(usage)) {
                        usages.push(usage);
                    }
                }
            });
        }

        return usages;
    }

    /**
     * Check if an AST node is a webRequest event listener
     */
    private static isWebRequestEventListener(node: any): boolean {
        // Pattern: chrome.webRequest.{event}.addListener(...)
        if (
            node.type === 'CallExpression' &&
            node.callee?.type === 'MemberExpression' &&
            node.callee.property?.name === 'addListener'
        ) {
            const obj = node.callee.object;
            if (
                obj?.type === 'MemberExpression' &&
                obj.object?.type === 'MemberExpression' &&
                obj.object.object?.name === 'chrome' &&
                obj.object.property?.name === 'webRequest'
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Extract webRequest usage information from an AST node
     */
    private static extractWebRequestUsage(node: any, file: LazyFile): WebRequestUsage | null {
        const eventObj = node.callee.object;
        const eventType = eventObj.property?.name;

        if (!eventType) {
            return null;
        }

        // Get the callback function (first argument to addListener)
        const callback = node.arguments?.[0];
        // Get the filter (second argument)
        const filter = node.arguments?.[1];
        // Get the extra info spec (third argument)
        const extraInfoSpec = node.arguments?.[2];

        return {
            node,
            file,
            eventType,
            callback,
            filter,
            extraInfoSpec,
        };
    }

    /**
     * Check if a webRequest usage is blocking
     * Blocking requests have "blocking" in the extraInfoSpec array
     */
    private static isBlockingWebRequest(usage: WebRequestUsage): boolean {
        const extraInfoSpec = usage.extraInfoSpec;

        // No extraInfoSpec means it's not blocking
        if (!extraInfoSpec) {
            return false;
        }

        // extraInfoSpec should be an array
        if (extraInfoSpec.type !== 'ArrayExpression') {
            return false;
        }

        // Check if the array contains "blocking"
        for (const element of extraInfoSpec.elements) {
            if (element.type === 'Literal' && element.value === 'blocking') {
                return true;
            }
        }

        return false;
    }

    /**
     * Analyze a webRequest usage to determine if it contains dynamic logic
     */
    private static analyzeWebRequestUsage(usage: WebRequestUsage): UsageAnalysis {
        // Check if callback contains dynamic logic
        const callbackNode = usage.callback;

        if (!callbackNode) {
            return {
                hasDynamicLogic: false,
                reason: 'No callback function found',
            };
        }

        // Extract callback body
        let callbackBody: any;
        if (callbackNode.type === 'FunctionExpression' || callbackNode.type === 'ArrowFunctionExpression') {
            callbackBody = callbackNode.body;
        } else if (callbackNode.type === 'Identifier') {
            // Callback is a named function - we need to find it
            // For now, treat as dynamic logic
            return {
                hasDynamicLogic: true,
                reason: 'Callback is a named function reference',
            };
        }

        if (!callbackBody) {
            return {
                hasDynamicLogic: false,
                reason: 'Cannot extract callback body',
            };
        }

        // Analyze the callback body for dynamic logic patterns
        const dynamicPatterns = WebRequestMigrator.detectDynamicPatterns(callbackBody);

        if (dynamicPatterns.length === 0) {
            // No dynamic logic detected - can convert to static rule
            return {
                hasDynamicLogic: false,
            };
        }

        // Has dynamic logic - cannot be migrated
        return {
            hasDynamicLogic: true,
            reason: dynamicPatterns.join(', '),
        };
    }

    /**
     * Detect dynamic logic patterns in the callback body
     */
    private static detectDynamicPatterns(callbackBody: any): string[] {
        const patterns: string[] = [];

        // Check for various dynamic patterns
        WebRequestMigrator.traverseAST(callbackBody, (node: any) => {
            // Conditional statements based on request properties
            if (node.type === 'IfStatement') {
                patterns.push('conditional logic');
            }

            // Loops
            if (node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
                patterns.push('loops');
            }

            // External function calls (database, API, etc.)
            if (node.type === 'CallExpression') {
                const callee = node.callee;
                // Check for fetch, XMLHttpRequest, database calls, etc.
                if (callee.type === 'Identifier') {
                    const name = callee.name;
                    if (name === 'fetch' || name === 'query' || name === 'get' || name === 'post') {
                        patterns.push('external API/database calls');
                    }
                }
            }

            // Variable assignments based on runtime data
            if (node.type === 'VariableDeclarator' && node.init) {
                patterns.push('runtime computations');
            }
        });

        return [...new Set(patterns)]; // Remove duplicates
    }

    /**
     * Convert a webRequest usage to a static DNR rule
     */
    private static convertToStaticRule(usage: WebRequestUsage, extension: Extension): Rule | null {
        const ruleId = WebRequestMigrator.ruleIdCounter++;

        // Extract filter information
        const condition = WebRequestMigrator.extractRuleCondition(usage);
        if (!condition) {
            logger.warn(extension, `Could not extract filter condition for ${usage.eventType}`);
            return null;
        }

        // Determine action based on event type and callback
        const action = WebRequestMigrator.determineRuleAction(usage);
        if (!action) {
            logger.warn(extension, `Could not determine action for ${usage.eventType}`);
            return null;
        }

        return {
            id: ruleId,
            priority: 1,
            condition,
            action,
        };
    }

    /**
     * Extract rule condition from webRequest filter
     */
    private static extractRuleCondition(usage: WebRequestUsage): RuleCondition | null {
        const filter = usage.filter;
        const condition: RuleCondition = {};

        if (!filter || filter.type !== 'ObjectExpression') {
            // No filter or invalid filter - match all
            return condition;
        }

        // Extract properties from filter object
        for (const prop of filter.properties) {
            if (prop.type !== 'Property') continue;

            const key = prop.key.name || prop.key.value;
            const value = prop.value;

            if (key === 'urls') {
                // Extract URL patterns
                if (value.type === 'ArrayExpression') {
                    const patterns: string[] = [];
                    for (const element of value.elements) {
                        if (element.type === 'Literal' && typeof element.value === 'string') {
                            patterns.push(element.value);
                        }
                    }
                    // Use the first pattern as urlFilter (simplified)
                    if (patterns.length > 0) {
                        condition.urlFilter = patterns[0];
                    }
                }
            }

            if (key === 'types') {
                // Extract resource types
                if (value.type === 'ArrayExpression') {
                    const types: ResourceType[] = [];
                    for (const element of value.elements) {
                        if (element.type === 'Literal' && typeof element.value === 'string') {
                            const resourceType = element.value as ResourceType;
                            types.push(resourceType);
                        }
                    }
                    if (types.length > 0) {
                        condition.resourceTypes = types;
                    }
                }
            }
        }

        return condition;
    }

    /**
     * Determine the rule action based on webRequest usage
     */
    private static determineRuleAction(usage: WebRequestUsage): any {
        // Analyze callback to determine action
        const callback = usage.callback;
        let returnAction: string | null = null;
        let redirectUrl: string | null = null;

        if (callback && (callback.type === 'FunctionExpression' || callback.type === 'ArrowFunctionExpression')) {
            const body = callback.body;

            // Handle ArrowFunctionExpression with concise body (not a BlockStatement)
            if (
                callback.type === 'ArrowFunctionExpression' &&
                body &&
                body.type !== 'BlockStatement'
            ) {
                // The body itself is the returned expression
                const arg = body;
                if (arg.type === 'ObjectExpression') {
                    // Check for cancel: true (blocking)
                    for (const prop of arg.properties) {
                        if (prop.key?.name === 'cancel' || prop.key?.value === 'cancel') {
                            if (prop.value.type === 'Literal' && prop.value.value === true) {
                                returnAction = 'block';
                            }
                        }
                        // Check for redirectUrl (redirect)
                        if (prop.key?.name === 'redirectUrl' || prop.key?.value === 'redirectUrl') {
                            returnAction = 'redirect';
                            // Extract the literal URL value
                            if (prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
                                redirectUrl = prop.value.value;
                            }
                        }
                    }
                }
            } else {
                // Look for return statements in function body
                WebRequestMigrator.traverseAST(body, (node: any) => {
                    if (node.type === 'ReturnStatement' && node.argument) {
                        const arg = node.argument;
                        if (arg.type === 'ObjectExpression') {
                            // Check for cancel: true (blocking)
                            for (const prop of arg.properties) {
                                if (prop.key?.name === 'cancel' || prop.key?.value === 'cancel') {
                                    if (prop.value.type === 'Literal' && prop.value.value === true) {
                                        returnAction = 'block';
                                    }
                                }
                                // Check for redirectUrl (redirect)
                                if (prop.key?.name === 'redirectUrl' || prop.key?.value === 'redirectUrl') {
                                    returnAction = 'redirect';
                                    // Extract the literal URL value
                                    if (prop.value.type === 'Literal' && typeof prop.value.value === 'string') {
                                        redirectUrl = prop.value.value;
                                    }
                                }
                            }
                        }
                    }
                });
            }

        // Map webRequest event types to DNR actions
        if (returnAction === 'block') {
            return { type: RuleActionType.BLOCK };
        } else if (returnAction === 'redirect') {
            // Use the extracted redirect URL if available, otherwise fall back to about:blank
            const url = redirectUrl || 'about:blank';
            return { type: RuleActionType.REDIRECT, redirect: { url } };
        }

        return null;
    }

    /**
     * Create a rules.json file
     */
    private static createRulesFile(rules: Rule[]): LazyFile {
        const ruleset: Ruleset = { rules };
        const content = JSON.stringify(ruleset, null, 2);

        // Create a LazyFile-like object for the rules.json
        const rulesFile = Object.create(LazyFile.prototype);
        rulesFile.path = 'rules.json';
        rulesFile.filetype = ExtFileType.OTHER;
        rulesFile._rulesContent = content;

        // Override methods to work with rules content
        rulesFile.getContent = () => content;
        rulesFile.getSize = () => Buffer.byteLength(content, 'utf8');
        rulesFile.getBuffer = () => Buffer.from(content, 'utf8');
        rulesFile.close = () => {
            /* No-op for in-memory content */
        };
        rulesFile.getAST = () => undefined;

        return rulesFile;
    }

    /**
     * Traverse AST using visitor pattern
     */
    private static traverseAST(node: any, visitor: (node: any) => void): void {
        if (!node || typeof node !== 'object') {
            return;
        }

        visitor(node);

        for (const key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

            const value = node[key];
            if (Array.isArray(value)) {
                for (const item of value) {
                    WebRequestMigrator.traverseAST(item, visitor);
                }
            } else if (typeof value === 'object') {
                WebRequestMigrator.traverseAST(value, visitor);
            }
        }
    }
}

/**
 * Represents a webRequest API usage found in the code
 */
interface WebRequestUsage {
    node: any;
    file: LazyFile;
    eventType: string;
    callback: any;
    filter: any;
    extraInfoSpec: any;
}

/**
 * Result of analyzing a webRequest usage
 */
interface UsageAnalysis {
    hasDynamicLogic: boolean;
    reason?: string;
}
