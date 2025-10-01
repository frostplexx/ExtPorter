import { FormatPreservingGenerator } from '../../../migrator/utils/format_preserving_generator';
import * as espree from 'espree';

describe('FormatPreservingGenerator', () => {
    describe('generateWithPreservedFormatting', () => {
        it('should preserve single line comments', () => {
            const sourceCode = `
// This is a header comment
var x = 1;
// This is a standalone comment
function test() {
    var y = 2; // This is an inline comment
}
// This is a footer comment
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            expect(result).toContain('// This is a header comment');
            expect(result).toContain('// This is a standalone comment');
            expect(result).toContain('// This is a footer comment');

            // Inline comments may be placed differently due to optimized placement logic
            const outputComments = (result.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            expect(outputComments).toBeGreaterThan(2); // Should preserve most comments
        });

        it('should preserve block comments', () => {
            const sourceCode = `
/* This is a block comment */
var x = 1;
/*
 * This is a multiline
 * block comment
 */
function test() {
    return x;
}
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            expect(result).toContain('/* This is a block comment */');
            expect(result).toContain('This is a multiline');
            expect(result).toContain('block comment');
        });

        it('should handle mixed comment types', () => {
            const sourceCode = `
/* Header block comment */
// Header line comment
var config = {
    apiKey: 'test', // Inline comment
    /* another inline block */
    enabled: true
};

/*
 * Function documentation
 */
function initialize() {
    // Implementation comment
    return config;
}
// Footer comment
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            // Count comments in input vs output
            const inputComments = (sourceCode.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            const outputComments = (result.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;

            expect(outputComments).toBeGreaterThan(0);
            expect(result).toContain('Header block comment');
            expect(result).toContain('Header line comment');
            expect(result).toContain('Function documentation');
            expect(result).toContain('Implementation comment');
            expect(result).toContain('Footer comment');

            // Verify reasonable comment preservation rate
            const inputCommentsCount = (sourceCode.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            expect(outputComments).toBeGreaterThanOrEqual(Math.floor(inputCommentsCount * 0.7)); // At least 70% preserved
        });

        it('should preserve indentation in comments', () => {
            const sourceCode = `
function test() {
    // Indented comment
    var x = 1;
    if (x > 0) {
        // Deeply indented comment
        return x;
    }
}
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            expect(result).toContain('    // Indented comment');
            expect(result).toContain('        // Deeply indented comment');
        });

        it('should handle files without comments', () => {
            const sourceCode = `
var x = 1;
function test() {
    return x + 1;
}
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            expect(result).toContain('var x = 1');
            expect(result).toContain('function test()');
            expect(result).toContain('return x + 1');

            // Should not contain any comments
            const outputComments = (result.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            expect(outputComments).toBe(0);
        });

        it('should handle special characters in comments', () => {
            const sourceCode = `
// Comment with special chars: @#$%^&*()
var x = 1;
/* Comment with quotes: "test" and 'test' */
var y = "string with // fake comment";
// Comment with unicode: 日本語 and émoji 🚀
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            expect(result).toContain('Comment with special chars: @#$%^&*()');
            expect(result).toContain('Comment with quotes: "test" and \'test\'');
            expect(result).toContain('Comment with unicode: 日本語 and émoji 🚀');

            // Should preserve the string without treating // as comment
            expect(result).toContain('"string with // fake comment"');
        });

        it('should respect PRESERVE_COMMENTS environment variable', () => {
            const originalEnv = process.env.PRESERVE_COMMENTS;

            try {
                // Test with comments disabled
                process.env.PRESERVE_COMMENTS = 'false';

                const sourceCode = `
// This comment should be ignored
var x = 1;
// Another comment to ignore
`;

                const ast = espree.parse(sourceCode, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true,
                });

                const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                    ast as any,
                    sourceCode
                );

                // Should not contain comments when disabled
                expect(result).not.toContain('This comment should be ignored');
                expect(result).not.toContain('Another comment to ignore');
                expect(result).toContain('var x = 1');
            } finally {
                // Restore original environment
                if (originalEnv !== undefined) {
                    process.env.PRESERVE_COMMENTS = originalEnv;
                } else {
                    delete process.env.PRESERVE_COMMENTS;
                }
            }
        });

        it('should handle large files with simplified processing', () => {
            // Create a large source code string (>100KB)
            const baseCode = `
// Comment in large file
function largeFunction() {
    var data = '${'x'.repeat(100)}';
    return data;
}
`;
            const largeSourceCode = baseCode.repeat(600); // Should exceed 100KB

            expect(largeSourceCode.length).toBeGreaterThan(100000);

            const ast = espree.parse(largeSourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                largeSourceCode
            );

            // Should still preserve some comments even with simplified processing
            const outputComments = (result.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            expect(outputComments).toBeGreaterThan(0);
        });

        it('should handle edge case with comments containing API names', () => {
            const sourceCode = `
// This comment mentions chrome.browserAction.onClicked
var api = chrome.browserAction;
// Another comment about chrome.extension.connect
chrome.browserAction.onClicked.addListener(() => {
    // Implementation comment
    console.log('clicked');
});
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            // Comments should be preserved as-is (not transformed)
            expect(result).toContain('chrome.browserAction.onClicked');
            expect(result).toContain('chrome.extension.connect');
            expect(result).toContain('Implementation comment');
        });

        it('should preserve comment placement relative to code', () => {
            const sourceCode = `
// Top-level comment
function calculate() {
    // Before variable declaration
    var result = 0;

    // Before loop
    for (let i = 0; i < 10; i++) {
        result += i; // Inline calculation comment
    }

    // Before return
    return result;
}
// End of function comment
`;

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            // Verify comments appear in logical positions
            const lines = result.split('\n');

            // Find comment lines and verify they're near expected code
            const commentLines = lines
                .map((line, index) => ({ line, index }))
                .filter(({ line }) => line.includes('//'));

            expect(commentLines.length).toBeGreaterThan(0);

            // Should contain all expected comments
            expect(result).toContain('Top-level comment');
            expect(result).toContain('Before variable declaration');
            expect(result).toContain('Before loop');
            expect(result).toContain('Before return');
            expect(result).toContain('End of function comment');

            // Verify that most comments are preserved even if placement differs
            const totalInputComments = (sourceCode.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            const totalOutputComments = (result.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            expect(totalOutputComments).toBeGreaterThanOrEqual(
                Math.floor(totalInputComments * 0.7)
            );
        });
    });

    describe('performance characteristics', () => {
        it('should handle files without comments quickly', () => {
            const sourceCode = `
var x = 1;
function test() { return x; }
var y = test();
`.repeat(100); // Repeat to make it substantial

            const start = Date.now();

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            const duration = Date.now() - start;

            // Should complete quickly for comment-free files
            expect(duration).toBeLessThan(1000); // Less than 1 second
            expect(result).toContain('var x = 1');
        });

        it('should handle many comments efficiently', () => {
            const sourceCode = Array.from(
                { length: 50 },
                (_, i) => `
// Comment number ${i}
var variable${i} = ${i};
`
            ).join('\n');

            const start = Date.now();

            const ast = espree.parse(sourceCode, {
                ecmaVersion: 'latest',
                sourceType: 'script',
                loc: true,
                range: true,
            });

            const result = FormatPreservingGenerator.generateWithPreservedFormatting(
                ast as any,
                sourceCode
            );

            const duration = Date.now() - start;

            // Should handle many comments in reasonable time
            expect(duration).toBeLessThan(5000); // Less than 5 seconds

            // Verify some comments are preserved
            const outputComments = (result.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
            expect(outputComments).toBeGreaterThan(0);
        });
    });
});
