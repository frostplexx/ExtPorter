/**
 * Uses a visitor pattern to traverse the AST once
 *
 * @param node Current AST node
 * @param visitor Function to call for each node
 */
export function traverseAST(node: any, visitor: (node: any) => void): void {
    // Early return for null/undefined/primitive values
    if (!node || typeof node !== 'object') {
        return;
    }

    // Visit current node
    visitor(node);

    // Traverse all object properties and arrays
    for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

        const value = node[key];
        if (Array.isArray(value)) {
            // Traverse array elements
            for (const item of value) {
                traverseAST(item, visitor);
            }
        } else if (typeof value === 'object') {
            // Traverse nested objects
            traverseAST(value, visitor);
        }
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
export function buildMemberExpressionPath(memberExpr: any): string {
    if (memberExpr.type !== 'MemberExpression') {
        return '';
    }

    const objectPath =
        memberExpr.object.type === 'MemberExpression'
            ? buildMemberExpressionPath(memberExpr.object)
            : memberExpr.object.name || '';

    const propertyName = memberExpr.property.name || '';

    return objectPath ? `${objectPath}.${propertyName}` : propertyName;
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
export function updateMemberExpressionPath(memberExpr: any, targetPattern: string): void {
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
export function nodeMatchesSourcePattern(node: any, source: any): boolean {
    // Extract clean API pattern from source (remove return/semicolon)
    const sourcePattern = source.body.replace(/^return\s+/, '').replace(/;$/, '');

    // Match function calls (e.g., chrome.extension.connect())
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
        const apiPath = buildMemberExpressionPath(node.callee);
        return sourcePattern === apiPath || sourcePattern.startsWith(apiPath + '(');
    }

    // Match property access (e.g., chrome.extension.onConnect)
    if (node.type === 'MemberExpression') {
        const apiPath = buildMemberExpressionPath(node);
        return sourcePattern === apiPath;
    }

    return false;
}
