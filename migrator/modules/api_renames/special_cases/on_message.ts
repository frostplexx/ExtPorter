import * as ESTree from 'estree';
import { buildMemberExpressionPath } from '../ast-utils';

/**
 * Transformer that ensures `chrome.runtime.onMessage.addListener` callbacks
 * which call `sendResponse` asynchronously contain `return true` at the top
 * level of the listener body.
 *
 * In Chrome extensions, the message channel is closed as soon as the listener
 * returns unless the listener explicitly returns `true`. When `sendResponse` is
 * called inside a nested callback, promise `.then()`, or an `async` function the
 * channel has already closed, so the response is silently dropped.
 *
 * This transformer detects that pattern and injects `return true;` as the last
 * statement of the listener body.
 */
export class OnMessageTransform {
    /**
     * Called once per AST node by the traversal loop.
     * Returns true when a transformation was applied so the caller increments
     * the transformationCount correctly.
     */
    public static try_transform(node: ESTree.Node): boolean {
        // Only interested in call expressions
        if (node.type !== 'CallExpression') return false;

        const call = node as ESTree.CallExpression;

        // Must be <something>.addListener(...)
        if (
            call.callee.type !== 'MemberExpression' ||
            (call.callee.property as ESTree.Identifier).name !== 'addListener'
        ) {
            return false;
        }

        // The object of addListener must be chrome.runtime.onMessage or
        // chrome.extension.onMessage (the latter gets renamed by api_renames but
        // may not have been processed yet — handle both)
        const objectPath = buildMemberExpressionPath(call.callee.object as any);
        if (
            objectPath !== 'chrome.runtime.onMessage' &&
            objectPath !== 'chrome.extension.onMessage'
        ) {
            return false;
        }

        // First argument must be a function (expression or arrow)
        if (call.arguments.length === 0) return false;
        const listenerArg = call.arguments[0];
        if (
            listenerArg.type !== 'FunctionExpression' &&
            listenerArg.type !== 'ArrowFunctionExpression'
        ) {
            return false;
        }

        const listener = listenerArg as ESTree.FunctionExpression | ESTree.ArrowFunctionExpression;

        // Arrow functions with a concise (expression) body cannot have statements
        // injected; skip them.
        if (listener.body.type !== 'BlockStatement') return false;

        const body = listener.body as ESTree.BlockStatement;

        // Determine the name used for the sendResponse parameter.
        // By convention it is the third parameter, but we also accept any parameter
        // named `sendResponse` at any position.
        const sendResponseName = OnMessageTransform.resolveSendResponseName(listener.params);
        if (!sendResponseName) return false;

        // If the listener already returns `true` at the top level, nothing to do.
        if (OnMessageTransform.hasTopLevelReturnTrue(body)) return false;

        // If the listener has any top-level `return` that is NOT `return true`
        // (e.g. `return false` or bare `return`) the developer intentionally
        // signals that the response is synchronous — do not change it.
        if (OnMessageTransform.hasTopLevelReturnNonTrue(body)) return false;

        // Check whether sendResponse is called inside a nested scope.
        if (!OnMessageTransform.sendResponseIsAsync(body, sendResponseName)) return false;

        // All conditions met — append `return true;`
        body.body.push(OnMessageTransform.buildReturnTrue());
        return true;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Returns the identifier name used for the sendResponse parameter.
     * Prefers a parameter literally named `sendResponse`; otherwise falls back
     * to the third positional parameter (index 2).
     */
    private static resolveSendResponseName(
        params: (ESTree.Pattern | ESTree.RestElement)[]
    ): string | null {
        // Named `sendResponse` at any position
        for (const param of params) {
            if (param.type === 'Identifier' && param.name === 'sendResponse') {
                return 'sendResponse';
            }
        }
        // Third positional parameter with any name
        if (params.length >= 3) {
            const third = params[2];
            if (third.type === 'Identifier') return third.name;
        }
        return null;
    }

    /**
     * Returns true when the block has a top-level `return true` statement.
     */
    private static hasTopLevelReturnTrue(block: ESTree.BlockStatement): boolean {
        for (const stmt of block.body) {
            if (
                stmt.type === 'ReturnStatement' &&
                stmt.argument?.type === 'Literal' &&
                (stmt.argument as ESTree.Literal).value === true
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * Returns true when the block has any top-level `return` statement whose
     * value is not `true` (catches `return false`, `return;`, `return undefined`,
     * etc.), including returns that appear as the direct consequent/alternate of
     * a top-level `IfStatement` guard clause (e.g. `if (cond) return false;`).
     * These mean the developer intentionally made the listener synchronous in at
     * least one code path.
     */
    private static hasTopLevelReturnNonTrue(block: ESTree.BlockStatement): boolean {
        for (const stmt of block.body) {
            // Direct return at top level
            if (stmt.type === 'ReturnStatement') {
                if (
                    stmt.argument?.type === 'Literal' &&
                    (stmt.argument as ESTree.Literal).value === true
                ) {
                    continue; // return true — not a disqualifier
                }
                return true;
            }

            // `if (cond) return false;` — single-statement consequent/alternate
            if (stmt.type === 'IfStatement') {
                const ifStmt = stmt as ESTree.IfStatement;
                for (const branch of [ifStmt.consequent, ifStmt.alternate]) {
                    if (!branch) continue;
                    if (branch.type === 'ReturnStatement') {
                        const ret = branch as ESTree.ReturnStatement;
                        if (
                            ret.argument?.type === 'Literal' &&
                            (ret.argument as ESTree.Literal).value === true
                        ) {
                            continue;
                        }
                        return true;
                    }
                }
            }
        }
        return false;
    }

    /**
     * Returns true when `sendResponseName` is called (as a `CallExpression`)
     * inside a nested scope within `block` — i.e. not at the direct top level
     * of the listener body but inside:
     *   - a nested FunctionExpression / ArrowFunctionExpression
     *   - a .then() / .catch() / .finally() callback
     *   - an AwaitExpression context (the listener itself is async)
     *
     * We do NOT flag sendResponse calls that appear only at the top level of the
     * listener body (those are synchronous and need no `return true`).
     */
    private static sendResponseIsAsync(
        listenerBody: ESTree.BlockStatement,
        sendResponseName: string
    ): boolean {
        return OnMessageTransform.searchNode(listenerBody, sendResponseName, false);
    }

    /**
     * Recursive search. `insideNested` tracks whether we have entered a scope
     * that is nested relative to the listener body.
     */
    private static searchNode(node: any, name: string, insideNested: boolean): boolean {
        if (!node || typeof node !== 'object') return false;

        // A call to sendResponse(...) inside a nested scope — this is async usage
        if (
            insideNested &&
            node.type === 'CallExpression' &&
            node.callee?.type === 'Identifier' &&
            node.callee.name === name
        ) {
            return true;
        }

        // Entering a new nested function scope: flag as nested for children
        const createsNewScope =
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression' ||
            node.type === 'FunctionDeclaration';

        const nextNested = insideNested || createsNewScope;

        // Recurse into all child properties
        for (const key of Object.keys(node)) {
            const child = node[key];
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (OnMessageTransform.searchNode(item, name, nextNested)) return true;
                }
            } else if (child && typeof child === 'object' && child.type) {
                if (OnMessageTransform.searchNode(child, name, nextNested)) return true;
            }
        }

        return false;
    }

    /**
     * Builds the AST node for `return true;`
     */
    private static buildReturnTrue(): ESTree.ReturnStatement {
        return {
            type: 'ReturnStatement',
            argument: {
                type: 'Literal',
                value: true,
                raw: 'true',
            } as ESTree.Literal,
        };
    }
}
