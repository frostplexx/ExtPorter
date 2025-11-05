import { buildMemberExpressionPath } from './ast-utils';

/**
 * Checks if parameter transformation is required based on source and target mappings.
 *
 * @param source Source mapping definition
 * @param target Target mapping definition
 * @returns True if parameters need to be restructured
 */
export function isParameterTransformationRequired(source: any, target: any): boolean {
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
export function transformParameters(callNode: any, source: any): void {
    const apiPath = buildMemberExpressionPath(callNode.callee);
    const sourcePattern = source.body.replace(/^return\s+/, '').replace(/;$/, '');

    // Handle chrome.tabs.executeScript transformation specifically
    if (apiPath === 'chrome.scripting.executeScript') {
        transformExecuteScriptParameters(callNode);
    }
    // Handle chrome.tabs.getAllInWindow -> chrome.tabs.query transformation
    else if (sourcePattern.startsWith('chrome.tabs.getAllInWindow(')) {
        transformGetAllInWindowParameters(callNode);
    }
    // Handle chrome.tabs.getSelected -> chrome.tabs.query transformation
    else if (sourcePattern.startsWith('chrome.tabs.getSelected(')) {
        transformGetSelectedParameters(callNode);
    }

    // Future parameter transformations can be added here
    // else if (apiPath === 'chrome.other.api') {
    //     transformOtherApiParameters(callNode);
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
export function transformExecuteScriptParameters(callNode: any): void {
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
        const injectionObject = createInjectionObject(tabIdArg, detailsArg);

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
            const injectionObject = createInjectionObject(null, detailsArg);

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
        const injectionObject = createInjectionObject(null, detailsArg);

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
export function transformGetAllInWindowParameters(callNode: any): void {
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
export function transformGetSelectedParameters(callNode: any): void {
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
 * Creates an injection object for chrome.scripting.executeScript.
 *
 * @param tabIdArg AST node for tabId (null for current tab)
 * @param detailsArg AST node for execution details
 * @returns ObjectExpression AST node for injection parameter
 */
function createInjectionObject(tabIdArg: any, detailsArg: any): any {
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
