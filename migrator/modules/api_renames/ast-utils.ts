/**
 * Re-exports from central AST utilities module.
 * This file is kept for backwards compatibility with existing imports.
 */
export {
    traverseAST,
    buildMemberExpressionPath,
    updateMemberExpressionPath,
    nodeMatchesSourcePattern,
    isWebRequestEventListener,
} from '../../utils/ast-utils';
