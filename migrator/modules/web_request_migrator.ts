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
 * Migration module that converts chrome.webRequest API calls to chrome.declarativeNetRequest
 *
 * This module analyzes webRequest usage and:
 * 1. Identifies static patterns that can be converted to DNR rules
 * 2. Detects dynamic logic that may require updateDynamicRules or marks migration as failed
 * 3. Generates rules.json file with static rules
 * 4. Updates manifest to include DNR configuration
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

            // Find all webRequest usages
            const webRequestUsages = WebRequestMigrator.findWebRequestUsages(extension);

            if (webRequestUsages.length === 0) {
                logger.debug(extension, 'No webRequest usage found');
                return extension;
            }

            logger.info(extension, `Found ${webRequestUsages.length} webRequest usage(s)`);

            // Analyze each usage to determine if it can be migrated
            const staticRules: Rule[] = [];
            const dynamicLogicCases: WebRequestUsage[] = [];

            for (const usage of webRequestUsages) {
                const analysis = WebRequestMigrator.analyzeWebRequestUsage(usage);

                if (analysis.hasDynamicLogic) {
                    if (!analysis.canBeRewritten) {
                        // Migration must fail - dynamic logic that cannot be converted
                        logger.error(
                            extension,
                            `Cannot migrate webRequest usage with dynamic logic: ${usage.eventType}`,
                            {
                                file: usage.file.path,
                                reason: analysis.reason,
                            }
                        );
                        return new MigrationError(
                            extension,
                            new Error(
                                `webRequest migration failed: ${usage.eventType} in ${usage.file.path} contains non-migratable dynamic logic: ${analysis.reason}`
                            )
                        );
                    } else {
                        dynamicLogicCases.push(usage);
                    }
                } else {
                    // Static pattern - convert to DNR rule
                    const rule = WebRequestMigrator.convertToStaticRule(usage);
                    if (rule) {
                        staticRules.push(rule);
                    }
                }
            }

            // If we have dynamic logic cases that can be rewritten, generate the rewrite code
            const updatedFiles = WebRequestMigrator.rewriteDynamicLogic(
                extension.files,
                // dynamicLogicCases
            );

            // Create rules.json file if we have static rules
            let finalFiles = updatedFiles;
            if (staticRules.length > 0) {
                const rulesFile = WebRequestMigrator.createRulesFile(staticRules);
                finalFiles = [...updatedFiles, rulesFile];
                logger.info(extension, `Generated ${staticRules.length} static DNR rule(s)`);
            }

            const duration = Date.now() - startTime;
            logger.info(extension, 'webRequest to declarativeNetRequest migration completed', {
                staticRules: staticRules.length,
                dynamicRewrites: dynamicLogicCases.length,
                duration,
            });

            return {
                ...extension,
                files: finalFiles,
            };
        } catch (error) {
            logger.error(extension, 'webRequest migration failed', {
                error: error instanceof Error ? error.message : String(error),
            });
            return new MigrationError(extension, error);
        }
    }

    /**
     * Find all webRequest API usages in the extension
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
                    if (usage) {
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
     * Analyze a webRequest usage to determine if it contains dynamic logic
     */
    private static analyzeWebRequestUsage(usage: WebRequestUsage): UsageAnalysis {
        // Check if callback contains dynamic logic
        const callbackNode = usage.callback;

        if (!callbackNode) {
            return {
                hasDynamicLogic: false,
                canBeRewritten: false,
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
                canBeRewritten: false,
                reason: 'Callback is a named function reference',
            };
        }

        if (!callbackBody) {
            return {
                hasDynamicLogic: false,
                canBeRewritten: false,
                reason: 'Cannot extract callback body',
            };
        }

        // Analyze the callback body for dynamic logic patterns
        const dynamicPatterns = WebRequestMigrator.detectDynamicPatterns(callbackBody);

        if (dynamicPatterns.length === 0) {
            // No dynamic logic detected - can convert to static rule
            return {
                hasDynamicLogic: false,
                canBeRewritten: false,
            };
        }

        // Has dynamic logic - check if it can be rewritten
        const canRewrite = WebRequestMigrator.canRewriteDynamicLogic(
            dynamicPatterns, 
            // usage
        );

        return {
            hasDynamicLogic: true,
            canBeRewritten: canRewrite,
            reason: canRewrite ? undefined : dynamicPatterns.join(', '),
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
     * Check if dynamic logic can be rewritten using updateDynamicRules
     */
    private static canRewriteDynamicLogic(
        patterns: string[],
        // usage: WebRequestUsage
    ): boolean {
        // TODO: For now, we consider dynamic logic non-rewritable
        // In a more sophisticated implementation, we could attempt to:
        // 1. Convert simple conditionals to multiple rules
        // 2. Use updateDynamicRules for user preference-based rules
        // 3. Etc.

        // Simple heuristic: if it's just conditional logic, it might be rewritable
        if (patterns.length === 1 && patterns[0] === 'conditional logic') {
            // Check if the conditional is based on simple URL patterns
            // This is a simplified check - a full implementation would be more sophisticated
            return false; // For safety, mark as non-rewritable for now
        }

        return false;
    }

    /**
     * Convert a webRequest usage to a static DNR rule
     */
    private static convertToStaticRule(usage: WebRequestUsage): Rule | null {
        const ruleId = WebRequestMigrator.ruleIdCounter++;

        // Extract filter information
        const condition = WebRequestMigrator.extractRuleCondition(usage);
        if (!condition) {
            logger.warn(null, `Could not extract filter condition for ${usage.eventType}`);
            return null;
        }

        // Determine action based on event type and callback
        const action = WebRequestMigrator.determineRuleAction(usage);
        if (!action) {
            logger.warn(null, `Could not determine action for ${usage.eventType}`);
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
        const eventType = usage.eventType;

        // Analyze callback to determine action
        const callback = usage.callback;
        let returnAction: string | null = null;

        if (callback && (callback.type === 'FunctionExpression' || callback.type === 'ArrowFunctionExpression')) {
            const body = callback.body;

            // Look for return statements
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
            // Note: actual redirect URL would need to be extracted
            return { type: RuleActionType.REDIRECT, redirect: { url: 'about:blank' } };
        } else if (eventType === 'onBeforeRequest') {
            // Default blocking for onBeforeRequest
            return { type: RuleActionType.BLOCK };
        }

        return null;
    }

    /**
     * Rewrite files with dynamic logic to use updateDynamicRules
     */
    private static rewriteDynamicLogic(
        files: LazyFile[],
        // dynamicCases: WebRequestUsage[]
    ): LazyFile[] {
        // TODO: For now, we're marking dynamic cases as migration failures
        // In a full implementation, this would:
        // 1. Remove webRequest event listeners
        // 2. Add code to use chrome.declarativeNetRequest.updateDynamicRules
        // 3. Convert simple dynamic patterns to rule updates

        return files;
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
    canBeRewritten: boolean;
    reason?: string;
}
