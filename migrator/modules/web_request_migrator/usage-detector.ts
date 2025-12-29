import { Extension } from '../../types/extension';
import { LazyFile } from '../../types/abstract_file';
import { ExtFileType } from '../../types/ext_file_types';
import { WebRequestUsage } from './types';
import { traverseAST, isWebRequestEventListener } from './ast-utils';
import { logger } from '../../utils/logger';

/**
 * Find all blocking webRequest API usages in the extension
 * Only returns webRequest listeners that have "blocking" in extraInfoSpec
 */
export function findWebRequestUsages(extension: Extension): WebRequestUsage[] {
    const usages: WebRequestUsage[] = [];

    for (const file of extension.files) {
        
        if(!file){
            logger.error(extension, "File is null")
            break;
        }

        if (file.filetype !== ExtFileType.JS) {
            continue;
        }

        const ast = file.getAST();
        if (!ast) {
            continue;
        }

        // Traverse AST to find chrome.webRequest.* event listeners
        traverseAST(ast, (node: any) => {
            if (isWebRequestEventListener(node)) {
                const usage = extractWebRequestUsage(node, file);
                // Only include blocking webRequest usages
                if (
                    usage &&
                    isBlockingWebRequest(usage) &&
                    usage.eventType === 'onBeforeRequest'
                ) {
                    usages.push(usage);
                }
            }
        });
    }

    return usages;
}

/**
 * Extract webRequest usage information from an AST node
 */
function extractWebRequestUsage(node: any, file: LazyFile): WebRequestUsage | null {
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
function isBlockingWebRequest(usage: WebRequestUsage): boolean {
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
