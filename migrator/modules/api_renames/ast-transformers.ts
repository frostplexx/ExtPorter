import * as ESTree from 'estree';
import { TwinningMapping } from '../../types/twinning_mapping';
import { logger } from '../../utils/logger';
import { traverseAST, nodeMatchesSourcePattern, updateMemberExpressionPath } from './ast-utils';
import { isParameterTransformationRequired, transformParameters } from './parameter-transformers';
import { applySpecialTranforms } from './special-case-transformers';
import { ContextMenuTranform } from './special_cases/context_menu';

/**
 * Applies API transformations to an AST.
 *
 * @param ast The AST to transform
 * @param mappings API transformation mappings
 * @param filePath File path for logging
 * @returns Object with transformed AST and transformation count
 */
export function applyApiTransformations(
    ast: ESTree.Node,
    mappings: TwinningMapping,
    filePath: string
): { transformedAST: ESTree.Node; transformationCount: number } {
    // clone AST to avoid modifying original
    // stringifing and parsing the ast is really the way youre supposed to do it:
    // https://dev.to/fpaghar/copy-objects-ways-in-javascript-24gj
    const transformedAST = JSON.parse(JSON.stringify(ast));
    let transformationCount = 0;

    // traverse the AST
    traverseAST(transformedAST, (node: any) => {
        if (applySpecialTranforms(node)) {
            transformationCount++;
            return;
        }

        // try each mapping until one matches (first-match wins)
        for (const mapping of mappings.mappings) {
            if (nodeMatchesSourcePattern(node, mapping.source)) {
                applyTargetTransformation(node, mapping.target, mapping.source);
                transformationCount++;
                break; // Only apply first matching transformation per node
            }
        }
    });

    // Add contextMenus.onClicked listener after all other transformations
    if (ContextMenuTranform.contextMenuCalls.length > 0) {
        ContextMenuTranform.addContextMenusOnClickedListener(
            transformedAST,
            ContextMenuTranform.contextMenuCalls
        );
        // Clear the accumulated calls for the next file
        ContextMenuTranform.contextMenuCalls = [];
    }

    if (transformationCount > 0) {
        logger.debug(null, 'API transformation summary', {
            file: filePath,
            transformationsApplied: transformationCount,
        });
    }

    return { transformedAST, transformationCount };
}

/**
 * Applies a target transformation to an AST node.
 *
 * Modifies the node in-place to change the API path according to
 * the target pattern (e.g., chrome.extension -> chrome.runtime).
 * Also handles parameter restructuring for APIs that require it.
 *
 * @param node AST node to transform
 * @param target Target pattern from mapping
 * @param source Source pattern from mapping (needed for parameter transformation)
 */
function applyTargetTransformation(node: any, target: any, source?: any): void {
    const targetPattern = target.body.replace(/^return\s+/, '').replace(/;$/, '');

    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
        // Transform function call member expression
        updateMemberExpressionPath(node.callee, targetPattern);

        // Handle parameter transformation if needed
        if (source && isParameterTransformationRequired(source, target)) {
            transformParameters(node, source);
        }
    } else if (node.type === 'MemberExpression') {
        // Transform property access member expression
        updateMemberExpressionPath(node, targetPattern);
    }
}
