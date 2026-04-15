import * as escodegen from 'escodegen';
import * as ESTree from 'estree';
import { logger } from './logger';

/**
 * Utility for generating JavaScript code while attempting to preserve
 * original formatting characteristics like indentation style and comments
 */
export class FormatPreservingGenerator {

    /**
     * Analyze the original source code to detect formatting preferences
     */
    private static analyzeFormatting(originalSource: string): {
        indentStyle: string;
        indentSize: number;
        newlineStyle: string;
        usesTrailingCommas: boolean;
        quotStyle: 'single' | 'double';
    } {
        const lines = originalSource.split(/\r?\n/);
        const indentCounts: { [key: string]: number } = {};
        let crlfCount = 0;
        let lfCount = 0;
        let singleQuotes = 0;
        let doubleQuotes = 0;
        let trailingCommas = 0;

        // Analyze indentation patterns
        for (const line of lines) {
            const match = line.match(/^(\s+)/);
            if (match) {
                const indent = match[1];
                indentCounts[indent] = (indentCounts[indent] || 0) + 1;
            }
        }

        // Analyze newline style
        const crlfMatches = originalSource.match(/\r\n/g);
        const lfMatches = originalSource.match(/(?<!\r)\n/g);
        if (crlfMatches) crlfCount = crlfMatches.length;
        if (lfMatches) lfCount = lfMatches.length;

        // Analyze quote style
        const singleQuoteMatches = originalSource.match(/'[^']*'/g);
        const doubleQuoteMatches = originalSource.match(/"[^"]*"/g);
        if (singleQuoteMatches) singleQuotes = singleQuoteMatches.length;
        if (doubleQuoteMatches) doubleQuotes = doubleQuoteMatches.length;

        // Analyze trailing commas
        const trailingCommaMatches = originalSource.match(/,\s*[}\]]/g);
        if (trailingCommaMatches) trailingCommas = trailingCommaMatches.length;

        // Determine most common indentation
        let commonIndent = '    '; // Default to 4 spaces
        let maxCount = 0;
        for (const [indent, count] of Object.entries(indentCounts)) {
            if (count > maxCount) {
                maxCount = count;
                commonIndent = indent;
            }
        }

        // Detect if using tabs or spaces
        const usesSpaces = commonIndent.includes(' ');
        const usesTabs = commonIndent.includes('\t');

        let indentStyle = '    '; // Default
        let indentSize = 4;

        if (usesTabs) {
            indentStyle = '\t';
            indentSize = 1;
        } else if (usesSpaces) {
            indentStyle = ' '.repeat(commonIndent.length);
            indentSize = commonIndent.length;
        }

        return {
            indentStyle,
            indentSize,
            newlineStyle: crlfCount > lfCount ? '\r\n' : '\n',
            usesTrailingCommas: trailingCommas > 0,
            quotStyle: singleQuotes > doubleQuotes ? 'single' : 'double',
        };
    }


    /**
     * Generate JavaScript code with formatting that matches the original source
     */
    public static generateWithPreservedFormatting(
        ast: ESTree.Node,
        originalSource: string
    ): string {

        const formatting = this.analyzeFormatting(originalSource);

        // Generate code with preserved formatting
        const generated = escodegen.generate(ast, {
            comment: true,
            format: {
                indent: {
                    style: formatting.indentStyle,
                    adjustMultilineComment: true,
                },
                newline: formatting.newlineStyle,
                space: ' ',
                json: false,
                quotes: formatting.quotStyle,
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: true,
                preserveBlankLines: false,
            },
        });

        return generated;
    }

    /**
     * Generate JavaScript with standard formatting (fallback)
     */
    public static generateWithStandardFormatting(ast: ESTree.Node): string {
        return escodegen.generate(ast, {
            comment: true,
            format: {
                indent: {
                    style: '    ', // 4 spaces
                    adjustMultilineComment: true,
                },
                newline: '\n',
                space: ' ',
                json: false,
                quotes: 'single',
                compact: false,
                parentheses: true,
                semicolons: true,
                safeConcatenation: true,
            },
        });
    }

    /**
     * Attempt to preserve line-level formatting by comparing original and generated code
     */
    public static preserveLineFormatting(
        originalSource: string,
        generatedSource: string,
        modifiedLines: Set<number>
    ): string {
        const originalLines = originalSource.split(/\r?\n/);
        const generatedLines = generatedSource.split(/\r?\n/);
        const resultLines: string[] = [];

        // This is a simplified approach - for full preservation, we'd need
        // more sophisticated line mapping between original and generated AST
        for (let i = 0; i < Math.max(originalLines.length, generatedLines.length); i++) {
            if (i < originalLines.length && !modifiedLines.has(i + 1)) {
                // Use original line if it wasn't modified
                resultLines.push(originalLines[i]);
            } else if (i < generatedLines.length) {
                // Use generated line if it was modified
                resultLines.push(generatedLines[i]);
            }
        }

        return resultLines.join('\n');
    }
}
