/**
 * Traverse AST using visitor pattern
 */
export function traverseAST(node: any, visitor: (node: any) => void): void {
    if (!node || typeof node !== 'object') {
        return;
    }

    visitor(node);

    for (const key in node) {
        if (!Object.prototype.hasOwnProperty.call(node, key)) continue;

        const value = node[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                traverseAST(item, visitor);
            }
        } else if (typeof value === 'object') {
            traverseAST(value, visitor);
        }
    }
}

/**
 * Check if an AST node is a webRequest event listener
 */
export function isWebRequestEventListener(node: any): boolean {
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
