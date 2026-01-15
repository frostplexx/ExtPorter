import { WebRequestUsage, UsageAnalysis } from './types';
import { traverseAST } from '../../utils/ast-utils';

/**
 * Analyze a webRequest usage to determine if it contains dynamic logic
 */
export function analyzeWebRequestUsage(usage: WebRequestUsage): UsageAnalysis {
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
    if (
        callbackNode.type === 'FunctionExpression' ||
        callbackNode.type === 'ArrowFunctionExpression'
    ) {
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
    const dynamicPatterns = detectDynamicPatterns(callbackBody);

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
function detectDynamicPatterns(callbackBody: any): string[] {
    const patterns: string[] = [];

    // Check for various dynamic patterns
    traverseAST(callbackBody, (node: any) => {
        // Conditional statements based on request properties
        if (node.type === 'IfStatement') {
            patterns.push('conditional logic');
        }

        // Loops
        if (
            node.type === 'ForStatement' ||
            node.type === 'WhileStatement' ||
            node.type === 'DoWhileStatement'
        ) {
            patterns.push('loops');
        }

        // External function calls (database, API, etc.)
        if (node.type === 'CallExpression') {
            const callee = node.callee;
            // Check for fetch and other network APIs
            if (callee.type === 'Identifier') {
                const name = callee.name;
                // Only flag known network APIs
                if (name === 'fetch') {
                    patterns.push('external API/database calls');
                }
            } else if (callee.type === 'MemberExpression') {
                // Flag axios.get/axios.post and similar member calls
                const objectName = callee.object && callee.object.name;
                const propertyName = callee.property && callee.property.name;
                if (
                    (objectName === 'axios' &&
                        (propertyName === 'get' || propertyName === 'post')) ||
                    (objectName === 'http' &&
                        (propertyName === 'get' || propertyName === 'post')) ||
                    (objectName === 'https' &&
                        (propertyName === 'get' || propertyName === 'post'))
                ) {
                    patterns.push('external API/database calls');
                }
            }
        }

        // Check for new XMLHttpRequest()
        if (node.type === 'NewExpression' && node.callee?.name === 'XMLHttpRequest') {
            patterns.push('external API/database calls');
        }

        // Variable assignments based on runtime data
        if (node.type === 'VariableDeclarator' && node.init) {
            // Only flag if initializer is not a literal or references request details
            const isNonLiteral = node.init.type !== 'Literal';
            // Check if initializer references callback parameter (e.g., 'details')
            let referencesCallbackParam = false;
            if (
                isNonLiteral &&
                node.init.type === 'Identifier' &&
                node.init.name === 'details'
            ) {
                referencesCallbackParam = true;
            }
            // Also check for MemberExpression like details.url, details.method, etc.
            if (
                isNonLiteral &&
                node.init.type === 'MemberExpression' &&
                node.init.object &&
                node.init.object.type === 'Identifier' &&
                node.init.object.name === 'details'
            ) {
                referencesCallbackParam = true;
            }
            if (isNonLiteral || referencesCallbackParam) {
                patterns.push('runtime computations');
            }
        }
    });

    return [...new Set(patterns)]; // Remove duplicates
}
