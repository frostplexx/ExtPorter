import { ContextMenuTranform } from './special_cases/context_menu';
import { WindowOpenTranform } from './special_cases/window_open';
import { SpecialTransform } from '../../types/special_transform';

/**
 * Applies special case transformations to an AST node.
 * Iterates through all special case transformers and applies the first matching one.
 *
 * @param node AST node to potentially transform
 * @returns True if a transformation was applied, false otherwise
 */
export function applySpecialTranforms(node: any): boolean {
    const special_cases: (typeof SpecialTransform)[] = [
        ContextMenuTranform,
        WindowOpenTranform,
    ];

    for (const special_case of special_cases) {
        if (special_case.try_transform(node)) {
            return true;
        }
    }

    return false;
}
