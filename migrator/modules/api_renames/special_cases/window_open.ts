import { buildMemberExpressionPath } from '../ast-utils';
import { logger } from '../../../utils/logger';
import { SpecialTransform } from '../../../types/special_transform';



export class WindowOpenTranform implements SpecialTransform {
    
    // Special handling for window.open() in service workers
    public static try_transform(node: any): boolean {
        if (this.isWindowOpenCall(node)) {
            this.transformWindowOpenToTabsCreate(node);
            return true
        }

        return false
    }

    /**
     * Checks if an AST node is a window.open() call.
     *
     * @param node AST node to check
     * @returns True if node is a window.open() call
     */
    public static isWindowOpenCall(node: any): boolean {
        if (node.type !== 'CallExpression') return false;

        // Check for window.open()
        if (node.callee?.type === 'MemberExpression') {
            const apiPath = buildMemberExpressionPath(node.callee);
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
    public static transformWindowOpenToTabsCreate(node: any): void {
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
}
