import { MCPServer } from './mcp-server';
import { LLMService } from './llm-service';
import { ChatMessage } from './types';
import { logger } from '../../utils/logger';
import { LLMToolCall, FileDiff, LLMMessage, LLMFixAttempt } from '../../types/llm_fix_attempt';
import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';

export interface ExtensionFixContext {
    extensionId: string;
    extensionName: string;
    extensionDir: string;
    manifestPath: string;
    manifest: any;
    report: any; // Report from testing
}

export interface FixResult {
    success: boolean;
    message: string;
    filesModified: string[];
    error?: string;
    // Extended data for database storage
    fixAttempt?: LLMFixAttempt;
}

/**
 * LLM-powered extension fixer that uses MCP to read/write files
 */
export class ExtensionFixer {
    private llmService: LLMService;
    private mcpServer: MCPServer;
    private context: ExtensionFixContext;
    private maxIterations: number = 50; // Prevent infinite loops

    // Token management - conservative estimate (128k limit, keep under 100k for safety)
    private readonly maxContextTokens: number = 90000;
    private readonly tokensPerChar: number = 0.3; // Rough estimate: ~3-4 chars per token

    // Memory management limits
    private readonly maxFileCacheSize: number = 50; // Maximum number of files to cache for diffs
    private readonly maxConversationMessages: number = 100; // Maximum conversation history length
    private readonly maxToolCallHistory: number = 200; // Maximum tool call history length
    private readonly maxFileDiffs: number = 100; // Maximum file diffs to keep

    // Tracking data for database storage
    private conversationHistory: LLMMessage[] = [];
    private toolCallHistory: LLMToolCall[] = [];
    private fileDiffs: FileDiff[] = [];
    private fileContentCache: Map<string, string> = new Map(); // Cache original file content for diffs
    private startedAt: number = 0;
    private iterations: number = 0;

    constructor(llmService: LLMService, context: ExtensionFixContext) {
        this.llmService = llmService;
        this.context = context;
        this.mcpServer = new MCPServer(context.extensionDir);
    }

    /**
     * Fix the extension using LLM with MCP tools
     */
    async fixExtension(): Promise<FixResult> {
        // Reset tracking state
        this.conversationHistory = [];
        this.toolCallHistory = [];
        this.fileDiffs = [];
        this.fileContentCache.clear();
        this.startedAt = Date.now();
        this.iterations = 0;

        try {
            logger.info(
                null,
                `Starting LLM-powered fix for extension: ${this.context.extensionName}`
            );

            // Build initial context for LLM
            const initialMessages = await this.buildInitialMessages();

            // Track initial messages in conversation history
            for (const msg of initialMessages) {
                this.conversationHistory.push({
                    role: msg.role,
                    content: msg.content,
                    timestamp: Date.now(),
                });
            }

            logger.info(null, `Initial prompt sent to LLM:`);
            logger.info(null, JSON.stringify(initialMessages, null, 2));

            // Interactive loop: LLM requests tools, we execute, send results back
            const result = await this.interactiveFixLoop(initialMessages);

            // Build the complete fix attempt record
            // IMPORTANT: Create copies of arrays since cleanup() will clear the originals
            const completedAt = Date.now();
            const fixAttempt: LLMFixAttempt = {
                id: crypto.randomUUID(),
                extension_id: this.context.extensionId,
                extension_name: this.context.extensionName,
                report_id: this.context.report?.id,
                started_at: this.startedAt,
                completed_at: completedAt,
                duration_ms: completedAt - this.startedAt,
                success: result.success,
                message: result.message,
                error: result.error,
                files_modified: [...result.filesModified],
                conversation: [...this.conversationHistory],
                tool_calls: [...this.toolCallHistory],
                file_diffs: [...this.fileDiffs],
                iterations: this.iterations,
                metadata: {
                    max_iterations: this.maxIterations,
                    extension_dir: this.context.extensionDir,
                },
            };

            // Attach the fix attempt to the result
            result.fixAttempt = fixAttempt;

            return result;
        } catch (error) {
            logger.error(null, 'Error during extension fix:', error);

            // Better error message extraction
            let errorMessage = 'Unknown error';
            if (error instanceof Error) {
                errorMessage = error.message || error.toString();
                // Handle AggregateError with nested errors
                if ('errors' in error && Array.isArray((error as any).errors)) {
                    const aggregateError = error as any;
                    errorMessage = aggregateError.errors.map((e: Error) => e.message).join('; ');
                }
            } else {
                errorMessage = String(error);
            }

            // Build fix attempt even for errors
            // IMPORTANT: Create copies of arrays since cleanup() will clear the originals
            const completedAt = Date.now();
            const fixAttempt: LLMFixAttempt = {
                id: crypto.randomUUID(),
                extension_id: this.context.extensionId,
                extension_name: this.context.extensionName,
                report_id: this.context.report?.id,
                started_at: this.startedAt,
                completed_at: completedAt,
                duration_ms: completedAt - this.startedAt,
                success: false,
                message: 'Failed to fix extension',
                error: errorMessage,
                files_modified: [],
                conversation: [...this.conversationHistory],
                tool_calls: [...this.toolCallHistory],
                file_diffs: [...this.fileDiffs],
                iterations: this.iterations,
                metadata: {
                    max_iterations: this.maxIterations,
                    extension_dir: this.context.extensionDir,
                },
            };

            return {
                success: false,
                message: 'Failed to fix extension',
                filesModified: [],
                error: errorMessage,
                fixAttempt,
            };
        } finally {
            // Always cleanup to prevent memory leaks
            this.cleanup();
        }
    }

    /**
     * Build initial message context for the LLM
     */
    private async buildInitialMessages(): Promise<ChatMessage[]> {
        const messages: ChatMessage[] = [];

        // System message with tools description
        messages.push({
            role: 'system',
            content: `You are an expert Chrome extension developer specializing in fixing broken extensions after migration from Manifest V2 to Manifest V3.

Your task is to analyze the extension and fix any issues reported during testing.

${MCPServer.getToolsDescription()}

After analyzing the issue and making fixes, respond with:
DONE
SUMMARY: <brief summary of changes made>

Remember:
- Only modify files that need to be fixed
- Preserve existing functionality
- Follow Chrome Extension best practices
- Test-driven: fix the specific issues mentioned in the report`,
        });

        // User message with extension context
        const reportSummary = this.buildReportSummary();
        const filesList = await this.getExtensionFilesList();

        messages.push({
            role: 'user',
            content: `Please fix the following extension:

Extension Name: ${this.context.extensionName}
Extension ID: ${this.context.extensionId}

## Test Report
${reportSummary}

## Available Files
${filesList}

## Manifest.json
\`\`\`json
${JSON.stringify(this.context.manifest, null, 2)}
\`\`\`

Please analyze the issues and fix them. Start by listing the files you need to examine, then make the necessary fixes.`,
        });

        return messages;
    }

    /**
     * Build a summary of the test report
     */
    private buildReportSummary(): string {
        const report = this.context.report;
        const lines: string[] = [];

        lines.push(`Overall Status: ${report.overall_working || 'Unknown'}`);

        if (report.installs === false) {
            lines.push('⚠ Extension does not install successfully');
        }

        if (report.works_in_mv2 === false) {
            lines.push('⚠ Extension does not work in MV2');
        }

        if (report.is_popup_working === false) {
            lines.push('⚠ Popup is not working');
        }

        if (report.is_settings_working === false) {
            lines.push('⚠ Settings page is not working');
        }

        if (report.is_new_tab_working === false) {
            lines.push('⚠ New tab override is not working');
        }

        if (report.listeners && report.listeners.length > 0) {
            lines.push('\n### Event Listeners Status:');
            for (const listener of report.listeners) {
                const status =
                    listener.status === 'yes' ? '✓' : listener.status === 'no' ? '✗' : '?';
                lines.push(
                    `  ${status} ${listener.api} (${listener.file}:${listener.line || '?'})`
                );
            }
        }

        if (report.notes) {
            lines.push(`\n### Additional Notes:\n${report.notes}`);
        }

        return lines.join('\n');
    }

    /**
     * Get list of extension files
     */
    private async getExtensionFilesList(): Promise<string> {
        const result = await this.mcpServer.executeTool('list_files', { directory: '' });

        if (!result.success) {
            return 'Unable to list files';
        }

        return result.files.join('\n');
    }

    /**
     * Interactive loop: LLM uses tools until it's done
     */
    private async interactiveFixLoop(messages: ChatMessage[]): Promise<FixResult> {
        const filesModified: Set<string> = new Set();

        while (this.iterations < this.maxIterations) {
            this.iterations++;

            logger.info(null, `LLM interaction iteration ${this.iterations}/${this.maxIterations}`);

            // Compress conversation if needed before sending to LLM
            const compressedMessages = this.compressConversation(messages);

            // Get LLM response
            const response = await this.llmService.generateChatCompletion(compressedMessages, {
                streamToConsole: false,
            });

            logger.info(null, `LLM response (${response.length} chars)`);
            logger.info(null, `LLM response content:\n${response}`);
            logger.info(null, `---END OF LLM RESPONSE---`);

            // Track assistant response in conversation history
            this.conversationHistory.push({
                role: 'assistant',
                content: response,
                timestamp: Date.now(),
            });

            // Check if LLM is done
            if (response.includes('DONE')) {
                const summary = this.extractSummary(response);
                logger.info(null, `LLM indicated completion. Summary: ${summary}`);
                logger.info(
                    null,
                    `Files modified: ${Array.from(filesModified).join(', ') || 'none'}`
                );
                return {
                    success: true,
                    message: summary,
                    filesModified: Array.from(filesModified),
                };
            }

            // Parse tool calls from response
            const toolCalls = this.parseToolCalls(response);

            if (toolCalls.length === 0) {
                // No tool calls found, ask LLM to continue
                messages.push({ role: 'assistant', content: response });
                const continueMessage =
                    'Please continue with your analysis or use tools to fix the extension. When done, respond with DONE.';
                messages.push({
                    role: 'user',
                    content: continueMessage,
                });
                // Track the continue message
                this.conversationHistory.push({
                    role: 'user',
                    content: continueMessage,
                    timestamp: Date.now(),
                });
                continue;
            }

            // Execute tool calls and track them
            const toolResults: string[] = [];
            for (const toolCall of toolCalls) {
                logger.info(null, `Executing tool: ${toolCall.name} with params:`, toolCall.params);

                const toolCallRecord: LLMToolCall = {
                    tool: toolCall.name,
                    params: toolCall.params,
                    result: { success: false },
                    timestamp: Date.now(),
                };

                try {
                    // For write_file, capture the original content for diff
                    if (toolCall.name === 'write_file') {
                        await this.captureFileContentForDiff(toolCall.params.file_path);
                    }

                    const result = await this.mcpServer.executeTool(toolCall.name, toolCall.params);

                    // Use summarized tool result for conversation (to save tokens)
                    toolResults.push(this.summarizeToolResult(toolCall.name, result));

                    // Track tool call result (full result for database)
                    toolCallRecord.result = {
                        success: result.success,
                        data: result,
                        error: result.error,
                    };

                    // Track modified files and capture diff
                    if (toolCall.name === 'write_file' && result.success) {
                        filesModified.add(toolCall.params.file_path);
                        // Record the file diff
                        this.recordFileDiff(toolCall.params.file_path, toolCall.params.content);
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    toolResults.push(`Tool: ${toolCall.name}\nError: ${errorMsg}`);
                    toolCallRecord.result = {
                        success: false,
                        error: errorMsg,
                    };
                }

                // Add to tool call history
                this.toolCallHistory.push(toolCallRecord);
            }

            // Trim tool call history to prevent memory growth
            this.trimToolCallHistory();

            // Add LLM response and tool results to conversation
            messages.push({ role: 'assistant', content: response });
            const toolResultsMessage = `Tool Results:\n\n${toolResults.join('\n\n---\n\n')}\n\nContinue analyzing or making fixes. When done, respond with DONE.`;
            messages.push({
                role: 'user',
                content: toolResultsMessage,
            });
            // Track tool results message (full version for database)
            this.conversationHistory.push({
                role: 'user',
                content: toolResultsMessage,
                timestamp: Date.now(),
            });

            // Trim conversation history to prevent memory growth
            this.trimConversationHistory();
        }

        // Max iterations reached
        return {
            success: false,
            message: 'Maximum iterations reached without completion',
            filesModified: Array.from(filesModified),
            error: 'Timeout: LLM did not complete the fix within the iteration limit',
        };
    }

    /**
     * Capture file content before modification for diff tracking.
     * Implements cache eviction to prevent unbounded memory growth.
     */
    private async captureFileContentForDiff(filePath: string): Promise<void> {
        if (this.fileContentCache.has(filePath)) {
            return; // Already cached
        }

        // Evict oldest entries if cache is full (FIFO eviction)
        if (this.fileContentCache.size >= this.maxFileCacheSize) {
            const firstKey = this.fileContentCache.keys().next().value;
            if (firstKey) {
                this.fileContentCache.delete(firstKey);
                logger.debug(null, `Evicted ${firstKey} from file content cache (size limit)`);
            }
        }

        try {
            const absolutePath = path.resolve(this.context.extensionDir, filePath);
            if (fs.existsSync(absolutePath)) {
                const content = await fs.readFile(absolutePath, 'utf-8');
                this.fileContentCache.set(filePath, content);
            }
            // If file doesn't exist, we'll record null as the "before" content (new file)
        } catch (error) {
            logger.warn(null, `Could not capture file content for diff: ${filePath}`, error);
        }
    }

    /**
     * Trim conversation history to prevent unbounded memory growth.
     * Keeps system message and most recent messages.
     */
    private trimConversationHistory(): void {
        if (this.conversationHistory.length <= this.maxConversationMessages) {
            return;
        }

        // Keep first message (usually system) and recent messages
        const toRemove = this.conversationHistory.length - this.maxConversationMessages;
        this.conversationHistory.splice(1, toRemove);
        logger.debug(
            null,
            `Trimmed ${toRemove} messages from conversation history (limit: ${this.maxConversationMessages})`
        );
    }

    /**
     * Trim tool call history to prevent unbounded memory growth.
     * Keeps only the most recent tool calls.
     */
    private trimToolCallHistory(): void {
        if (this.toolCallHistory.length <= this.maxToolCallHistory) {
            return;
        }

        // Remove oldest entries, keeping most recent
        const toRemove = this.toolCallHistory.length - this.maxToolCallHistory;
        this.toolCallHistory.splice(0, toRemove);
        logger.debug(
            null,
            `Trimmed ${toRemove} entries from tool call history (limit: ${this.maxToolCallHistory})`
        );
    }

    /**
     * Clean up all caches and resources after fix completes.
     * Should be called in finally block.
     * MEMORY OPTIMIZATION: Explicitly clear all arrays and maps to help GC
     */
    cleanup(): void {
        // Clear arrays by setting length to 0 (faster than reassignment)
        this.conversationHistory.length = 0;
        this.toolCallHistory.length = 0;
        this.fileDiffs.length = 0;

        // Clear the file content cache
        this.fileContentCache.clear();

        // Reset iteration counter
        this.iterations = 0;

        logger.debug(null, 'ExtensionFixer cleanup completed');
    }

    /**
     * Record a file diff after modification.
     * Implements size limit to prevent unbounded memory growth.
     */
    private recordFileDiff(filePath: string, newContent: string): void {
        const beforeContent = this.fileContentCache.get(filePath) ?? null;

        // Only record if content actually changed
        if (beforeContent !== newContent) {
            // MEMORY FIX: Limit the number of diffs we keep
            if (this.fileDiffs.length >= this.maxFileDiffs) {
                // Remove oldest diff
                this.fileDiffs.shift();
                logger.debug(null, `Evicted oldest file diff (limit: ${this.maxFileDiffs})`);
            }

            this.fileDiffs.push({
                filePath,
                before: beforeContent,
                after: newContent,
                timestamp: Date.now(),
            });
        }
    }

    /**
     * Estimate token count for a string (rough approximation)
     */
    private estimateTokens(text: string): number {
        return Math.ceil(text.length * this.tokensPerChar);
    }

    /**
     * Estimate total tokens in message array
     */
    private estimateMessagesTokens(messages: ChatMessage[]): number {
        return messages.reduce((total, msg) => total + this.estimateTokens(msg.content), 0);
    }

    /**
     * Truncate a file content string to a maximum length with indicator
     */
    private truncateContent(content: string, maxChars: number = 5000): string {
        if (content.length <= maxChars) {
            return content;
        }
        const halfMax = Math.floor(maxChars / 2);
        return (
            content.substring(0, halfMax) +
            `\n\n... [TRUNCATED ${content.length - maxChars} chars] ...\n\n` +
            content.substring(content.length - halfMax)
        );
    }

    /**
     * Summarize a tool result for context compression
     */
    private summarizeToolResult(toolName: string, result: any): string {
        if (toolName === 'read_file') {
            if (result.success && result.content) {
                const lines = result.content.split('\n').length;
                const chars = result.content.length;
                // Truncate large file contents
                const truncatedContent = this.truncateContent(result.content, 8000);
                return `Tool: ${toolName}\nResult: { success: true, content: "${truncatedContent}", _meta: { lines: ${lines}, chars: ${chars} } }`;
            }
        } else if (toolName === 'list_files') {
            if (result.success && result.files) {
                return `Tool: ${toolName}\nResult: { success: true, files: [${result.files.length} files: ${result.files.slice(0, 20).join(', ')}${result.files.length > 20 ? '...' : ''}] }`;
            }
        }
        // For write_file and others, just stringify normally but truncate if needed
        const resultStr = JSON.stringify(result, null, 2);
        return `Tool: ${toolName}\nResult: ${this.truncateContent(resultStr, 2000)}`;
    }

    /**
     * Compress conversation history to fit within token limits
     * Keeps system message and recent messages, summarizes middle
     */
    private compressConversation(messages: ChatMessage[]): ChatMessage[] {
        const estimatedTokens = this.estimateMessagesTokens(messages);

        if (estimatedTokens <= this.maxContextTokens) {
            return messages; // No compression needed
        }

        logger.info(
            null,
            `Compressing conversation: ${estimatedTokens} estimated tokens exceeds ${this.maxContextTokens} limit`
        );

        // Always keep: system message (first), and recent messages
        const systemMessage = messages[0]; // Assume first is system
        const recentCount = 4; // Keep last 4 messages (2 exchanges)
        const recentMessages = messages.slice(-recentCount);

        // Middle messages to summarize
        const middleMessages = messages.slice(1, -recentCount);

        if (middleMessages.length === 0) {
            // Nothing to compress in the middle, truncate the system message or recent
            return messages;
        }

        // Create a summary of middle conversation
        const fileReads: string[] = [];
        const fileWrites: string[] = [];
        const keyActions: string[] = [];

        for (const msg of middleMessages) {
            if (msg.role === 'user' && msg.content.includes('Tool Results:')) {
                // Extract tool results summary
                const readMatches = msg.content.match(
                    /Tool: read_file[\s\S]*?file_path['":\s]+['"]?([^'"}\s,]+)/g
                );
                if (readMatches) {
                    readMatches.forEach((m) => {
                        const fileMatch = m.match(/file_path['":\s]+['"]?([^'"}\s,]+)/);
                        if (fileMatch) fileReads.push(fileMatch[1]);
                    });
                }
                const writeMatches = msg.content.match(/Tool: write_file[\s\S]*?success: true/g);
                if (writeMatches) {
                    keyActions.push(`Wrote ${writeMatches.length} file(s)`);
                }
            } else if (msg.role === 'assistant') {
                // Look for key decisions/analysis
                if (msg.content.includes('TOOL_CALL: write_file')) {
                    const fileMatch = msg.content.match(/file_path['":\s]+['"]?([^'"}\s,]+)/);
                    if (fileMatch) fileWrites.push(fileMatch[1]);
                }
            }
        }

        // Build compressed summary message
        const summaryParts: string[] = ['[CONVERSATION HISTORY COMPRESSED]'];
        if (fileReads.length > 0) {
            summaryParts.push(`Files read: ${[...new Set(fileReads)].join(', ')}`);
        }
        if (fileWrites.length > 0) {
            summaryParts.push(`Files modified: ${[...new Set(fileWrites)].join(', ')}`);
        }
        if (keyActions.length > 0) {
            summaryParts.push(`Actions: ${keyActions.join('; ')}`);
        }
        summaryParts.push(`(${middleMessages.length} messages compressed)`);

        const summaryMessage: ChatMessage = {
            role: 'user',
            content: summaryParts.join('\n'),
        };

        const compressed = [systemMessage, summaryMessage, ...recentMessages];
        const newTokens = this.estimateMessagesTokens(compressed);
        logger.info(
            null,
            `Compressed to ${newTokens} estimated tokens (${compressed.length} messages)`
        );

        return compressed;
    }

    /**
     * Parse tool calls from LLM response
     */
    private parseToolCalls(response: string): Array<{ name: string; params: any }> {
        const toolCalls: Array<{ name: string; params: any }> = [];

        // First, find all TOOL_CALL markers and their positions
        const toolCallMarkerRegex = /TOOL_CALL:\s*(\w+)\s*\n?\s*PARAMS:\s*/gi;
        const markers: Array<{ name: string; startIndex: number }> = [];
        let markerMatch;

        while ((markerMatch = toolCallMarkerRegex.exec(response)) !== null) {
            markers.push({
                name: markerMatch[1],
                startIndex: markerMatch.index + markerMatch[0].length,
            });
        }

        // For each marker, extract the JSON by properly matching braces
        for (const marker of markers) {
            const jsonStr = this.extractJsonObject(response, marker.startIndex);
            if (jsonStr) {
                logger.info(
                    null,
                    `Parsing tool call: ${marker.name}, params length: ${jsonStr.length}`
                );

                try {
                    const params = JSON.parse(jsonStr);
                    toolCalls.push({ name: marker.name, params });
                } catch (error) {
                    logger.error(
                        null,
                        `Failed to parse tool params for ${marker.name}: ${jsonStr.substring(0, 200)}...`,
                        error
                    );
                }
            } else {
                logger.warn(null, `Could not extract JSON for tool call: ${marker.name}`);
            }
        }

        logger.info(null, `Parsed ${toolCalls.length} tool call(s)`);

        return toolCalls;
    }

    /**
     * Extract a complete JSON object from a string starting at the given index.
     * Handles nested braces and strings properly.
     */
    private extractJsonObject(str: string, startIndex: number): string | null {
        if (str[startIndex] !== '{') {
            return null;
        }

        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let endIndex = startIndex;

        for (let i = startIndex; i < str.length; i++) {
            const char = str[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\' && inString) {
                escapeNext = true;
                continue;
            }

            if (char === '"' && !escapeNext) {
                inString = !inString;
                continue;
            }

            if (!inString) {
                if (char === '{') {
                    depth++;
                } else if (char === '}') {
                    depth--;
                    if (depth === 0) {
                        endIndex = i;
                        break;
                    }
                }
            }
        }

        if (depth !== 0) {
            // Unbalanced braces
            return null;
        }

        return str.substring(startIndex, endIndex + 1);
    }

    /**
     * Extract summary from DONE response
     */
    private extractSummary(response: string): string {
        const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?:\n|$)/s);
        if (summaryMatch) {
            return summaryMatch[1].trim();
        }
        return 'Extension fixed successfully';
    }

    /**
     * Create an ExtensionFixer from extension document
     */
    static async fromExtension(
        llmService: LLMService,
        extension: any,
        report: any
    ): Promise<ExtensionFixer> {
        // Get extension directory (prefer MV3)
        const manifestPath = extension.manifest_v3_path || extension.manifest_v2_path;

        if (!manifestPath) {
            throw new Error('Extension does not have a manifest path');
        }

        const extensionDir = manifestPath.endsWith('manifest.json')
            ? path.dirname(manifestPath)
            : manifestPath;

        // Read manifest
        const manifestFile = path.join(extensionDir, 'manifest.json');
        let manifest = extension.manifest;

        if (!manifest && fs.existsSync(manifestFile)) {
            manifest = await fs.readJSON(manifestFile);
        }

        const context: ExtensionFixContext = {
            extensionId: extension.id || extension._id,
            extensionName: extension.name || 'Unknown Extension',
            extensionDir,
            manifestPath: manifestFile,
            manifest: manifest || {},
            report,
        };

        return new ExtensionFixer(llmService, context);
    }
}
