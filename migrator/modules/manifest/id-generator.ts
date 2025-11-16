import { Extension } from '../../types/extension';
import crypto from 'crypto';

/**
 * Generates a consistent MV3 extension ID based on extension name and original ID
 */
export function generateMV3ExtensionId(extension: Extension): string {
    // Use extension name + original ID to ensure uniqueness and consistency
    const seedData = `${extension.name}-${extension.id}-mv3`;

    return crypto
        .createHash('sha256')
        .update(seedData)
        .digest('hex')
        .substring(0, 32)
        .replace(/./g, (c: any) => String.fromCharCode(97 + (parseInt(c, 16) % 26)));
}
