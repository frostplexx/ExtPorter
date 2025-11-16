import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';
import { Rule, RuleActionType, ResourceType, RuleCondition } from '../../types/dnr_rule_types';
import { logger } from '../../utils/logger';
import { WebRequestUsage } from './types';
import { traverseAST } from './ast-utils';

let ruleIdCounter = 1;

/**
 * Reset the rule ID counter (useful for testing)
 */
export function resetRuleIdCounter(): void {
    ruleIdCounter = 1;
}

/**
 * Convert a webRequest usage to static DNR rules
 * Generates one rule per URL pattern to preserve all patterns from filter.urls
 */
export function convertToStaticRules(usage: WebRequestUsage, extension: Extension): Rule[] {
    // Determine action based on event type and callback
    const action = determineRuleAction(usage, extension);
    if (!action) {
        logger.warn(extension, `Could not determine action for ${usage.eventType}`);
        return [];
    }

    // Extract URL patterns and resource types
    const { urlPatterns, resourceTypes } = extractFilterInfo(usage);

    // If no URL patterns, create a single rule that matches all URLs
    if (urlPatterns.length === 0) {
        const ruleId = ruleIdCounter++;
        const condition: RuleCondition = {};
        if (resourceTypes.length > 0) {
            condition.resourceTypes = resourceTypes;
        }

        return [
            {
                id: ruleId,
                priority: 1,
                condition,
                action,
            },
        ];
    }

    // Create one rule per URL pattern
    const rules: Rule[] = [];
    for (const urlPattern of urlPatterns) {
        const ruleId = ruleIdCounter++;
        const condition: RuleCondition = {
            urlFilter: urlPattern,
        };

        if (resourceTypes.length > 0) {
            condition.resourceTypes = resourceTypes;
        }

        rules.push({
            id: ruleId,
            priority: 1,
            condition,
            action,
        });
    }

    return rules;
}

/**
 * Extract filter information from webRequest filter
 * Returns all URL patterns and resource types
 */
function extractFilterInfo(usage: WebRequestUsage): {
    urlPatterns: string[];
    resourceTypes: ResourceType[];
} {
    const filter = usage.filter;
    const urlPatterns: string[] = [];
    const resourceTypes: ResourceType[] = [];

    if (!filter || filter.type !== 'ObjectExpression') {
        // No filter or invalid filter
        return { urlPatterns, resourceTypes };
    }

    // Extract properties from filter object
    for (const prop of filter.properties) {
        if (prop.type !== 'Property') continue;

        const key = prop.key.name || prop.key.value;
        const value = prop.value;

        if (key === 'urls') {
            // Extract all URL patterns
            if (value.type === 'ArrayExpression') {
                for (const element of value.elements) {
                    if (element.type === 'Literal' && typeof element.value === 'string') {
                        urlPatterns.push(element.value);
                    }
                }
            }
        }

        if (key === 'types') {
            // Extract resource types
            if (value.type === 'ArrayExpression') {
                for (const element of value.elements) {
                    if (element.type === 'Literal' && typeof element.value === 'string') {
                        const resourceType = element.value as ResourceType;
                        resourceTypes.push(resourceType);
                    }
                }
            }
        }
    }

    return { urlPatterns, resourceTypes };
}

/**
 * Determine the rule action based on webRequest usage
 */
function determineRuleAction(usage: WebRequestUsage, extension: Extension): any {
    // Analyze callback to determine action
    const callback = usage.callback;
    let returnAction: string | null = null;
    let redirectUrl: string | null = null;

    if (
        callback &&
        (callback.type === 'FunctionExpression' || callback.type === 'ArrowFunctionExpression')
    ) {
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
                        if (
                            prop.value.type === 'Literal' &&
                            typeof prop.value.value === 'string'
                        ) {
                            redirectUrl = prop.value.value;
                        }
                    }
                }
            }
        } else {
            // Look for return statements in function body
            traverseAST(body, (node: any) => {
                if (node.type === 'ReturnStatement' && node.argument) {
                    const arg = node.argument;
                    if (arg.type === 'ObjectExpression') {
                        // Check for cancel: true (blocking)
                        for (const prop of arg.properties) {
                            if (prop.key?.name === 'cancel' || prop.key?.value === 'cancel') {
                                if (
                                    prop.value.type === 'Literal' &&
                                    prop.value.value === true
                                ) {
                                    returnAction = 'block';
                                }
                            }
                            // Check for redirectUrl (redirect)
                            if (
                                prop.key?.name === 'redirectUrl' ||
                                prop.key?.value === 'redirectUrl'
                            ) {
                                returnAction = 'redirect';
                                // Extract the literal URL value
                                if (
                                    prop.value.type === 'Literal' &&
                                    typeof prop.value.value === 'string'
                                ) {
                                    redirectUrl = prop.value.value;
                                }
                            }
                        }
                    }
                }
            });
        }
    }

    // Map webRequest event types to DNR actions
    if (returnAction === 'block') {
        return { type: RuleActionType.BLOCK };
    } else if (returnAction === 'redirect') {
        // Use the extracted redirect URL if available, otherwise log a warning and skip rule creation
        if (!redirectUrl) {
            logger.warn(
                extension,
                'Skipping redirect rule: redirectUrl is not a literal and cannot be migrated safely.'
            );
            return null;
        }
        return { type: RuleActionType.REDIRECT, redirect: { url: redirectUrl } };
    }

    return null;
}

/**
 * Create a rules.json file
 */
export function createRulesFile(rules: Rule[]): LazyFile {
    // Chrome expects rules.json to be a direct array, not an object with a "rules" property
    const content = JSON.stringify(rules, null, 2);

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
