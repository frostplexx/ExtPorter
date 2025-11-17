import { LazyFile } from '../../types/abstract_file';
import * as espree from 'espree';

/**
 * Scoring rules for background script selection
 */
const BG_SCRIPT_SCORE_MAP = new Map<RegExp, number>([
    // High priority - likely background scripts
    [/\bbackground(script)?\b/i, 15],
    [/\bbg\b/i, 10],
    [/\bworker\b/i, 12],
    [/\bservice[-_]?worker\b/i, 13],
    [/\bmain\b/i, 8],
    [/\bindex\b/i, 6],
    [/\binit\b/i, 7],
    [/\bcore\b/i, 5],

    // Medium priority - supporting files
    [/\bsrc\b/i, 4],
    [/\bscript\b/i, 3],
    [/\bapp\b/i, 3],
    [/\brun\b/i, 3],
    [/\blistener\b/i, 5],

    // Low priority - less likely to be background
    [/\butil(s|ity|ities)?\b/i, -3],
    [/\bhelper(s)?\b/i, -3],
    [/\bcommon\b/i, -2],
    [/\bshared\b/i, -2],
    [/\bconfig\b/i, -4],

    // Very low priority - definitely not background
    [/\bjquery\b/i, -100],
    [/\blib(rary|s)?\b/i, -10],
    [/\bvendor\b/i, -8],
    [/\bthird[-_]?party\b/i, -8],
    [/\bdeps?\b/i, -6],
    [/\bdependenc(y|ies)\b/i, -6],
    [/\bnode_modules\b/i, -12],
    [/\btest(s)?\b/i, -15],
    [/\bspec\b/i, -15],
    [/\bmock(s)?\b/i, -12],
    [/\bdemo\b/i, -10],
    [/\bexample(s)?\b/i, -10],
]);

/**
 * Pick correct background script based on heuristics
 */
export function bgScriptChooser(scripts: string[]): string {
    if (scripts.length === 0) {
        throw new Error('No scripts provided');
    }

    if (scripts.length === 1) {
        return scripts[0];
    }

    let bestScript = scripts[0];
    let bestScore = calculateScore(scripts[0], BG_SCRIPT_SCORE_MAP);

    for (let i = 1; i < scripts.length; i++) {
        const score = calculateScore(scripts[i], BG_SCRIPT_SCORE_MAP);

        if (score > bestScore) {
            bestScore = score;
            bestScript = scripts[i];
        }
    }

    return bestScript;
}

/**
 * Calculate score for a script based on regex patterns
 */
function calculateScore(script: string, scoreMap: Map<RegExp, number>): number {
    let score = 0;

    for (const [pattern, points] of scoreMap) {
        if (pattern.test(script)) {
            score += points;
        }
    }

    return score;
}

/**
 * Creates a transformed file with modified content stored in memory.
 * This avoids modifying the original MV2 source files.
 */
export function createTransformedFile(originalFile: LazyFile, newContent: string): LazyFile {
    // Create new instance inheriting from LazyFile prototype
    const transformedFile = Object.create(LazyFile.prototype);

    // Copy basic properties
    transformedFile.path = originalFile.path;
    transformedFile.filetype = originalFile.filetype;
    transformedFile._transformedContent = newContent;
    // Copy absolute path for reference (but won't write to it)
    transformedFile._absolutePath = (originalFile as any)._absolutePath;

    // Override methods to work with transformed content
    transformedFile.getContent = () => newContent;
    transformedFile.getSize = () => Buffer.byteLength(newContent, 'utf8');
    transformedFile.close = () => {
        /* No-op for in-memory content */
    };
    transformedFile.getAST = () => {
        // Parse the transformed content to generate AST for subsequent modules
        try {
            // Try as script first (most common)
            return espree.parse(newContent, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });
        } catch {
            try {
                // Fallback to module parsing
                return espree.parse(newContent, {
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    loc: true,
                    range: true,
                });
            } catch {
                // If parsing fails, return undefined
                return undefined;
            }
        }
    };
    transformedFile.getBuffer = () => Buffer.from(newContent, 'utf8');

    return transformedFile;
}
