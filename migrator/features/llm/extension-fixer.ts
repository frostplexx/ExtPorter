import { MCPServer } from './mcp-server';
import { LLMService } from './llm-service';
import { ChatMessage } from './types';
import { logger } from '../../utils/logger';
import * as path from 'path';
import * as fs from 'fs-extra';

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
}

/**
 * LLM-powered extension fixer that uses MCP to read/write files
 */
export class ExtensionFixer {
    private llmService: LLMService;
    private mcpServer: MCPServer;
    private context: ExtensionFixContext;
    private maxIterations: number = 10; // Prevent infinite loops

    constructor(llmService: LLMService, context: ExtensionFixContext) {
        this.llmService = llmService;
        this.context = context;
        this.mcpServer = new MCPServer(context.extensionDir);
    }

    /**
     * Fix the extension using LLM with MCP tools
     */
    async fixExtension(): Promise<FixResult> {
        try {
            logger.info(
                null,
                `Starting LLM-powered fix for extension: ${this.context.extensionName}`
            );

            // Build initial context for LLM
            const initialMessages = await this.buildInitialMessages();

            logger.info(null, `Initial prompt sent to LLM:`);
            logger.info(null, JSON.stringify(initialMessages, null, 2));

            // Interactive loop: LLM requests tools, we execute, send results back
            const result = await this.interactiveFixLoop(initialMessages);

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

            return {
                success: false,
                message: 'Failed to fix extension',
                filesModified: [],
                error: errorMessage,
            };
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
        let iterations = 0;

        while (iterations < this.maxIterations) {
            iterations++;

            logger.info(null, `LLM interaction iteration ${iterations}/${this.maxIterations}`);

            // Get LLM response
            const response = await this.llmService.generateChatCompletion(messages, {
                streamToConsole: false,
            });

            logger.info(null, `LLM response (${response.length} chars)`);
            logger.info(null, `LLM response content:\n${response}`);
            logger.info(null, `---END OF LLM RESPONSE---`);

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
                messages.push({
                    role: 'user',
                    content:
                        'Please continue with your analysis or use tools to fix the extension. When done, respond with DONE.',
                });
                continue;
            }

            // Execute tool calls
            const toolResults: string[] = [];
            for (const toolCall of toolCalls) {
                logger.info(null, `Executing tool: ${toolCall.name} with params:`, toolCall.params);

                try {
                    const result = await this.mcpServer.executeTool(toolCall.name, toolCall.params);
                    toolResults.push(
                        `Tool: ${toolCall.name}\nResult: ${JSON.stringify(result, null, 2)}`
                    );

                    // Track modified files
                    if (toolCall.name === 'write_file' && result.success) {
                        filesModified.add(toolCall.params.file_path);
                    }
                } catch (error) {
                    toolResults.push(
                        `Tool: ${toolCall.name}\nError: ${error instanceof Error ? error.message : String(error)}`
                    );
                }
            }

            // Add LLM response and tool results to conversation
            messages.push({ role: 'assistant', content: response });
            messages.push({
                role: 'user',
                content: `Tool Results:\n\n${toolResults.join('\n\n---\n\n')}\n\nContinue analyzing or making fixes. When done, respond with DONE.`,
            });
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
     * Parse tool calls from LLM response
     */
    private parseToolCalls(response: string): Array<{ name: string; params: any }> {
        const toolCalls: Array<{ name: string; params: any }> = [];

        // Match TOOL_CALL: <name> and PARAMS: <json>
        // Updated regex to handle newlines and complex JSON
        const toolCallRegex =
            /TOOL_CALL:\s*(\w+)\s*\n?\s*PARAMS:\s*(\{[\s\S]*?\}(?=\s*(?:TOOL_CALL:|DONE|$)))/gi;
        let match;

        while ((match = toolCallRegex.exec(response)) !== null) {
            const name = match[1];
            const paramsJson = match[2].trim();

            logger.info(null, `Parsing tool call: ${name}, params: ${paramsJson}`);

            try {
                const params = JSON.parse(paramsJson);
                toolCalls.push({ name, params });
            } catch (error) {
                logger.error(null, `Failed to parse tool params: ${paramsJson}`, error);
            }
        }

        logger.info(null, `Parsed ${toolCalls.length} tool call(s)`);

        return toolCalls;
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
