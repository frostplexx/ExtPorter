import * as escodegen from "escodegen";
import * as ESTree from "estree";
import { logger } from "./logger";

/**
 * Comment categories for intelligent placement
 */
type CommentCategory = "header" | "footer" | "inline" | "standalone";

/**
 * Code context information for comment mapping
 */
interface CodeContext {
  beforeLines: string[];
  afterLines: string[];
  nearestFunction: string | null;
  nearestVariable: string | null;
}

/**
 * Comprehensive comment information with position and context
 */
interface CommentInfo {
  type: "line" | "block";
  text: string;
  originalText: string;
  line: number;
  column: number;
  startIndex: number;
  endIndex: number;
  category: CommentCategory;
  context: CodeContext;
  indentation: string;
  isStandalone: boolean;
  hasCodeAfter: boolean;
  isMultiline?: boolean; // Only for block comments
}

/**
 * Utility for generating JavaScript code while attempting to preserve
 * original formatting characteristics like indentation style and comments
 */
export class FormatPreservingGenerator {
  // Cache compiled regex patterns for performance
  private static commentRegex = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
  private static whitespaceRegex = /^\s*/;

  /**
   * Analyze the original source code to detect formatting preferences
   */
  private static analyzeFormatting(originalSource: string): {
    indentStyle: string;
    indentSize: number;
    newlineStyle: string;
    usesTrailingCommas: boolean;
    quotStyle: "single" | "double";
  } {
    const lines = originalSource.split(/\r?\n/);
    const indentCounts: { [key: string]: number } = {};
    let totalNewlines = 0;
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
    let commonIndent = "    "; // Default to 4 spaces
    let maxCount = 0;
    for (const [indent, count] of Object.entries(indentCounts)) {
      if (count > maxCount) {
        maxCount = count;
        commonIndent = indent;
      }
    }

    // Detect if using tabs or spaces
    const usesSpaces = commonIndent.includes(" ");
    const usesTabs = commonIndent.includes("\t");

    let indentStyle = "    "; // Default
    let indentSize = 4;

    if (usesTabs) {
      indentStyle = "\t";
      indentSize = 1;
    } else if (usesSpaces) {
      indentStyle = " ".repeat(commonIndent.length);
      indentSize = commonIndent.length;
    }

    return {
      indentStyle,
      indentSize,
      newlineStyle: crlfCount > lfCount ? "\r\n" : "\n",
      usesTrailingCommas: trailingCommas > 0,
      quotStyle: singleQuotes > doubleQuotes ? "single" : "double",
    };
  }

  /**
   * Enhanced comment extraction with detailed position and context information
   */
  private static extractComments(originalSource: string): CommentInfo[] {
    const comments: CommentInfo[] = [];

    // Quick bailout for files without comments
    if (!originalSource.includes("//") && !originalSource.includes("/*")) {
      return comments;
    }

    // Skip expensive analysis for very large files
    if (originalSource.length > 100000) {
      // 100KB limit
      return this.extractCommentsSimple(originalSource);
    }

    const lines = originalSource.split("\n");
    let match;

    // Reset regex state and use cached regex
    this.commentRegex.lastIndex = 0;

    while ((match = this.commentRegex.exec(originalSource)) !== null) {
      const commentText = match[0];
      const startIndex = match.index!;
      const endIndex = startIndex + commentText.length;

      // Calculate line and column positions
      const beforeComment = originalSource.substring(0, startIndex);
      const lineNumber = (beforeComment.match(/\n/g) || []).length + 1;
      const lastNewline = beforeComment.lastIndexOf("\n");
      const column = startIndex - lastNewline;

      // Get the line content for context
      const sourceLine = lines[lineNumber - 1] || "";
      const beforeCommentOnLine = sourceLine.substring(0, column - 1);
      const afterCommentOnLine = sourceLine.substring(
        column - 1 + commentText.length,
      );

      // Determine comment category
      const category = this.categorizeComment(
        commentText,
        beforeCommentOnLine,
        lineNumber,
        lines.length,
      );

      // Get surrounding code context
      const context = this.getCodeContext(
        lines,
        lineNumber - 1,
        commentText.startsWith("//"),
      );

      if (commentText.startsWith("//")) {
        // Single line comment
        comments.push({
          type: "line",
          text: commentText.substring(2).trim(),
          originalText: commentText,
          line: lineNumber,
          column: column,
          startIndex: startIndex,
          endIndex: endIndex,
          category: category,
          context: context,
          indentation: beforeCommentOnLine.match(/^\s*/)?.[0] || "",
          isStandalone: beforeCommentOnLine.trim() === "",
          hasCodeAfter: afterCommentOnLine.trim() !== "",
        });
      } else {
        // Block comment
        const blockText = commentText.substring(2, commentText.length - 2);
        const isMultiline = blockText.includes("\n");

        comments.push({
          type: "block",
          text: blockText.trim(),
          originalText: commentText,
          line: lineNumber,
          column: column,
          startIndex: startIndex,
          endIndex: endIndex,
          category: category,
          context: context,
          indentation: beforeCommentOnLine.match(/^\s*/)?.[0] || "",
          isStandalone: beforeCommentOnLine.trim() === "",
          hasCodeAfter: afterCommentOnLine.trim() !== "",
          isMultiline: isMultiline,
        });
      }
    }

    return comments;
  }

  /**
   * Simple comment extraction for large files (performance optimization)
   */
  private static extractCommentsSimple(originalSource: string): CommentInfo[] {
    const comments: CommentInfo[] = [];
    const lines = originalSource.split("\n");

    // Simple line-by-line extraction without expensive context analysis
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineCommentMatch = line.match(/\/\/.*$/);

      if (lineCommentMatch) {
        const commentText = lineCommentMatch[0];
        const column = line.indexOf(commentText);
        comments.push({
          type: "line",
          text: commentText.substring(2).trim(),
          originalText: commentText,
          line: i + 1,
          column: column,
          startIndex: 0, // Not calculated for performance
          endIndex: 0,
          category: "standalone", // Simplified categorization
          context: {
            beforeLines: [],
            afterLines: [],
            nearestFunction: null,
            nearestVariable: null,
          },
          indentation:
            this.whitespaceRegex.exec(line.substring(0, column))?.[0] || "",
          isStandalone: line.substring(0, column).trim() === "",
          hasCodeAfter: false,
        });
      }
    }

    return comments;
  }

  /**
   * Categorize comments based on their position and context
   */
  private static categorizeComment(
    commentText: string,
    beforeCommentOnLine: string,
    lineNumber: number,
    totalLines: number,
  ): CommentCategory {
    const isFirstFewLines = lineNumber <= 5;
    const isLastFewLines = lineNumber > totalLines - 5;
    const hasCodeBefore = beforeCommentOnLine.trim() !== "";

    if (isFirstFewLines && !hasCodeBefore) {
      return "header";
    } else if (isLastFewLines && !hasCodeBefore) {
      return "footer";
    } else if (hasCodeBefore) {
      return "inline";
    } else {
      return "standalone";
    }
  }

  /**
   * Get surrounding code context for better comment placement
   */
  private static getCodeContext(
    lines: string[],
    lineIndex: number,
    isSingleLine: boolean,
  ): CodeContext {
    const maxContextLines = 3;
    const beforeLines: string[] = [];
    const afterLines: string[] = [];

    // Get context before comment
    for (let i = Math.max(0, lineIndex - maxContextLines); i < lineIndex; i++) {
      const line = lines[i]?.trim();
      if (line && !line.startsWith("//") && !line.startsWith("/*")) {
        beforeLines.push(line);
      }
    }

    // Get context after comment
    const startAfter = isSingleLine ? lineIndex + 1 : lineIndex;
    for (
      let i = startAfter;
      i < Math.min(lines.length, lineIndex + maxContextLines + 1);
      i++
    ) {
      const line = lines[i]?.trim();
      if (line && !line.startsWith("//") && !line.startsWith("/*")) {
        afterLines.push(line);
      }
    }

    return {
      beforeLines,
      afterLines,
      nearestFunction: this.findNearestFunction(lines, lineIndex),
      nearestVariable: this.findNearestVariable(lines, lineIndex),
    };
  }

  /**
   * Find the nearest function declaration for context
   */
  private static findNearestFunction(
    lines: string[],
    lineIndex: number,
  ): string | null {
    // Look backwards for function declarations
    for (let i = lineIndex; i >= 0; i--) {
      const line = lines[i];
      const functionMatch = line.match(
        /function\s+(\w+)|(\w+)\s*:\s*function|(\w+)\s*=\s*function/,
      );
      if (functionMatch) {
        return functionMatch[1] || functionMatch[2] || functionMatch[3];
      }
    }
    return null;
  }

  /**
   * Find the nearest variable declaration for context
   */
  private static findNearestVariable(
    lines: string[],
    lineIndex: number,
  ): string | null {
    // Look at the next few lines for variable declarations
    for (
      let i = lineIndex + 1;
      i < Math.min(lines.length, lineIndex + 3);
      i++
    ) {
      const line = lines[i];
      const varMatch = line.match(/(?:var|let|const)\s+(\w+)|(\w+)\s*[=:]/);
      if (varMatch) {
        return varMatch[1] || varMatch[2];
      }
    }
    return null;
  }

  /**
   * Intelligently inject comments back into generated code using context mapping
   */
  private static injectComments(
    generatedCode: string,
    comments: CommentInfo[],
  ): string {
    if (comments.length === 0) {
      return generatedCode;
    }

    const generatedLines = generatedCode.split("\n");
    const result: string[] = [];

    // Group comments by category for different handling strategies
    const commentsByCategory = {
      header: comments.filter((c) => c.category === "header"),
      footer: comments.filter((c) => c.category === "footer"),
      inline: comments.filter((c) => c.category === "inline"),
      standalone: comments.filter((c) => c.category === "standalone"),
    };

    // Track which comments have been used to prevent duplicates
    const usedComments = new Set<CommentInfo>();

    // 1. Add header comments first
    for (const comment of commentsByCategory.header) {
      if (!usedComments.has(comment)) {
        result.push(...this.formatComment(comment));
        usedComments.add(comment);
      }
    }

    if (commentsByCategory.header.length > 0) {
      result.push(""); // Blank line after header comments
    }

    // 2. Process generated code lines and inject inline/standalone comments
    for (let i = 0; i < generatedLines.length; i++) {
      const line = generatedLines[i];

      // Add any standalone comments that should appear before this line
      const standaloneBefore = this.findCommentsForLine(
        commentsByCategory.standalone.filter((c) => !usedComments.has(c)),
        line,
        i,
        generatedLines,
        "before",
      );

      for (const comment of standaloneBefore) {
        if (!usedComments.has(comment)) {
          result.push(...this.formatComment(comment, comment.indentation));
          usedComments.add(comment);
        }
      }

      // Add the actual code line
      result.push(line);

      // Add any inline comments that should appear after this line
      const inlineAfter = this.findCommentsForLine(
        commentsByCategory.inline.filter((c) => !usedComments.has(c)),
        line,
        i,
        generatedLines,
        "after",
      );

      for (const comment of inlineAfter) {
        if (!usedComments.has(comment)) {
          // For inline comments, try to add them on the same line if possible
          if (comment.type === "line" && line.trim() !== "") {
            const lastLineIndex = result.length - 1;
            result[lastLineIndex] =
              result[lastLineIndex] + " " + comment.originalText;
          } else {
            result.push(...this.formatComment(comment, comment.indentation));
          }
          usedComments.add(comment);
        }
      }
    }

    // 3. Add footer comments at the end
    const unusedFooterComments = commentsByCategory.footer.filter(
      (c) => !usedComments.has(c),
    );
    if (unusedFooterComments.length > 0) {
      result.push(""); // Blank line before footer comments
      for (const comment of unusedFooterComments) {
        if (!usedComments.has(comment)) {
          result.push(...this.formatComment(comment));
          usedComments.add(comment);
        }
      }
    }

    const finalResult = result.join("\n");

    return finalResult;
  }

  /**
   * Format a comment for insertion into generated code
   */
  private static formatComment(
    comment: CommentInfo,
    overrideIndentation?: string,
  ): string[] {
    const indentation = overrideIndentation || comment.indentation;
    const lines: string[] = [];

    if (comment.type === "line") {
      // Extract the actual comment text without the // prefix since comment.text includes it
      const cleanText = comment.text.startsWith("//")
        ? comment.text.substring(2).trim()
        : comment.text;
      lines.push(`${indentation}// ${cleanText}`);
    } else {
      // Block comment - extract content without /* */ wrapper
      let cleanText = comment.text;
      if (cleanText.startsWith("/*") && cleanText.endsWith("*/")) {
        cleanText = cleanText.substring(2, cleanText.length - 2);
      }

      if (comment.isMultiline) {
        lines.push(`${indentation}/*`);
        cleanText.split("\n").forEach((line) => {
          lines.push(`${indentation} * ${line.trim()}`);
        });
        lines.push(`${indentation} */`);
      } else {
        lines.push(`${indentation}/* ${cleanText.trim()} */`);
      }
    }

    return lines;
  }

  /**
   * Find comments that should be placed relative to a specific line of generated code
   */
  private static findCommentsForLine(
    comments: CommentInfo[],
    codeLine: string,
    lineIndex: number,
    allLines: string[],
    position: "before" | "after",
  ): CommentInfo[] {
    const matchingComments: CommentInfo[] = [];

    for (const comment of comments) {
      // Try to match comments based on context patterns
      const shouldInclude = this.shouldCommentBeIncludedAtLine(
        comment,
        codeLine,
        lineIndex,
        allLines,
        position,
      );

      if (shouldInclude) {
        matchingComments.push(comment);
      }
    }

    return matchingComments;
  }

  /**
   * Determine if a comment should be included at a specific line
   */
  private static shouldCommentBeIncludedAtLine(
    comment: CommentInfo,
    codeLine: string,
    lineIndex: number,
    allLines: string[],
    position: "before" | "after",
  ): boolean {
    // Simplified strategy: Only use basic placement logic for performance

    // Strategy 1: Simple function/variable name matching (no regex compilation)
    if (
      comment.context.nearestFunction &&
      codeLine.includes(comment.context.nearestFunction)
    ) {
      return position === "before";
    }

    if (
      comment.context.nearestVariable &&
      codeLine.includes(comment.context.nearestVariable)
    ) {
      return position === "before";
    }

    // Strategy 2: Simple placement for standalone comments
    if (comment.category === "standalone" && position === "before") {
      // Place before function declarations, variable declarations, or logical blocks
      return (
        codeLine.includes("function") ||
        codeLine.includes("var ") ||
        codeLine.includes("const ") ||
        codeLine.includes("let ") ||
        codeLine.trim().endsWith("{") ||
        lineIndex === 0
      );
    }

    return false;
  }

  /**
   * Calculate similarity between two code patterns
   */
  private static codePatternSimilarity(
    pattern1: string,
    pattern2: string,
  ): number {
    // Simple similarity calculation based on common keywords and structure
    const keywords1: string[] = pattern1.match(/\b\w+\b/g) || [];
    const keywords2: string[] = pattern2.match(/\b\w+\b/g) || [];

    const commonKeywords = keywords1.filter((word) => keywords2.includes(word));
    const totalKeywords = new Set([...keywords1, ...keywords2]).size;

    return totalKeywords > 0 ? commonKeywords.length / totalKeywords : 0;
  }

  /**
   * Generate JavaScript code with formatting that matches the original source
   */
  public static generateWithPreservedFormatting(
    ast: ESTree.Node,
    originalSource: string,
  ): string {
    // Performance toggle - disable comment preservation if requested
    const preserveComments = process.env.PRESERVE_COMMENTS !== "false";

    const formatting = this.analyzeFormatting(originalSource);
    const comments = preserveComments
      ? this.extractComments(originalSource)
      : [];

    // Generate code with preserved formatting
    const generated = escodegen.generate(ast, {
      comment: false, // We'll handle comments manually
      format: {
        indent: {
          style: formatting.indentStyle,
          adjustMultilineComment: true,
        },
        newline: formatting.newlineStyle,
        space: " ",
        json: false,
        quotes: formatting.quotStyle,
        compact: false,
        parentheses: true,
        semicolons: true,
        safeConcatenation: true,
        preserveBlankLines: false,
      },
    });

    // Inject comments back into the generated code
    let result: string;
    try {
      result = this.injectComments(generated, comments);
    } catch (error) {
      logger.error(null, error as any);
      result = generated; // Fall back to original generated code
    }

    return result;
  }

  /**
   * Generate JavaScript with standard formatting (fallback)
   */
  public static generateWithStandardFormatting(ast: ESTree.Node): string {
    return escodegen.generate(ast, {
      comment: true,
      format: {
        indent: {
          style: "    ", // 4 spaces
          adjustMultilineComment: true,
        },
        newline: "\n",
        space: " ",
        json: false,
        quotes: "single",
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
    modifiedLines: Set<number>,
  ): string {
    const originalLines = originalSource.split(/\r?\n/);
    const generatedLines = generatedSource.split(/\r?\n/);
    const resultLines: string[] = [];

    // This is a simplified approach - for full preservation, we'd need
    // more sophisticated line mapping between original and generated AST
    for (
      let i = 0;
      i < Math.max(originalLines.length, generatedLines.length);
      i++
    ) {
      if (i < originalLines.length && !modifiedLines.has(i + 1)) {
        // Use original line if it wasn't modified
        resultLines.push(originalLines[i]);
      } else if (i < generatedLines.length) {
        // Use generated line if it was modified
        resultLines.push(generatedLines[i]);
      }
    }

    return resultLines.join("\n");
  }
}
