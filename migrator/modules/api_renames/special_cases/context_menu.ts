import { buildMemberExpressionPath } from '../ast-utils';
import { logger } from '../../../utils/logger';
import { SpecialTransform } from '../../../types/special_transform';


export class ContextMenuTranform implements SpecialTransform {

    static contextMenuCalls: any[] = [];

    // Special handling for window.open() in service workers
    public static try_transform(node: any): boolean {
        if (this.isContextMenusCreateCall(node)) {
            const onclickProperty = this.extractOnclickFromContextMenu(node);
            if (onclickProperty) {
                this.contextMenuCalls.push({ node, onclickProperty });

                return true
            }
        }
        return false
    }

    /**
     * Checks if an AST node is a chrome.contextMenus.create() call.
     *
     * @param node AST node to check
     * @returns True if node is a contextMenus.create() call
     */
    static isContextMenusCreateCall(node: any): boolean {
        if (node.type !== 'CallExpression' || !node.callee?.type) return false;

        const apiPath = buildMemberExpressionPath(node.callee);
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
    static extractOnclickFromContextMenu(node: any): { onclick: any; menuId: any } | null {
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
    static addContextMenusOnClickedListener(ast: any, contextMenuCalls: any[]): void {
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

}
