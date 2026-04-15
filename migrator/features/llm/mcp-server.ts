import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../../utils/logger';

/**
 * MCP (Model Context Protocol) Server
 * Provides tools for LLM to interact with extension files
 */
export class MCPServer {
    private extensionDir: string;
    private allowedOperations: Set<string>;

    constructor(extensionDir: string) {
        // Convert to absolute path, normalize, and remove trailing slash for consistent comparisons
        this.extensionDir = path
            .normalize(path.resolve(extensionDir))
            .replace(new RegExp('[\\/]+$'), '');
        this.allowedOperations = new Set(['read_file', 'write_file', 'list_files']);

        logger.info(null, `MCP Server initialized with extension directory: ${this.extensionDir}`);
    }

    /**
     * Execute a tool request from the LLM
     */
    async executeTool(toolName: string, params: any): Promise<any> {
        if (!this.allowedOperations.has(toolName)) {
            throw new Error(`Tool '${toolName}' is not allowed`);
        }

        switch (toolName) {
            case 'read_file':
                return this.readFile(params.file_path);
            case 'write_file':
                return this.writeFile(params.file_path, params.content);
            case 'list_files':
                return this.listFiles(params.directory || '');
            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    }

    /**
     * Read a file from the extension directory
     */
    private async readFile(
        filePath: string
    ): Promise<{ content: string; success: boolean; error?: string }> {
        try {
            // Ensure the path is within the extension directory
            const absolutePath = this.resolveSafePath(filePath);

            if (!fs.existsSync(absolutePath)) {
                return {
                    success: false,
                    content: '',
                    error: `File not found: ${filePath}`,
                };
            }

            const content = await fs.readFile(absolutePath, 'utf-8');
            return {
                success: true,
                content,
            };
        } catch (error) {
            logger.error(null, `Error reading file ${filePath}:`, error);
            return {
                success: false,
                content: '',
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Write content to a file in the extension directory
     */
    private async writeFile(
        filePath: string,
        content: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Ensure the path is within the extension directory
            const absolutePath = this.resolveSafePath(filePath);

            // Ensure directory exists
            await fs.ensureDir(path.dirname(absolutePath));

            // Write the file
            await fs.writeFile(absolutePath, content, 'utf-8');

            return {
                success: true,
            };
        } catch (error) {
            logger.error(null, `Error writing file ${filePath}:`, error);
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * List files in a directory
     */
    private async listFiles(
        directory: string
    ): Promise<{ files: string[]; success: boolean; error?: string }> {
        try {
            // Ensure the path is within the extension directory
            const absolutePath = this.resolveSafePath(directory);

            if (!fs.existsSync(absolutePath)) {
                return {
                    success: false,
                    files: [],
                    error: `Directory not found: ${directory}`,
                };
            }

            const entries = await fs.readdir(absolutePath, { withFileTypes: true });
            const files = entries.map((entry) => {
                const name = entry.name;
                const fullPath = path.join(directory, name);
                return entry.isDirectory() ? `${fullPath}/` : fullPath;
            });

            return {
                success: true,
                files,
            };
        } catch (error) {
            logger.error(null, `Error listing directory ${directory}:`, error);
            return {
                success: false,
                files: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Resolve a path safely within the extension directory
     * Prevents directory traversal attacks
     */
    private resolveSafePath(filePath: string): string {
        // Normalize and resolve the path
        const resolved = path.normalize(path.resolve(this.extensionDir, filePath));
        const normalizedExtDir = path.normalize(this.extensionDir);

        // Ensure the resolved path is within the extension directory
        // Use path separator to prevent partial matches (e.g., /foo/bar vs /foo/barbaz)
        if (!resolved.startsWith(normalizedExtDir + path.sep) && resolved !== normalizedExtDir) {
            const error =
                `Path '${filePath}' is outside the extension directory.\n` +
                `  Extension dir: ${normalizedExtDir}\n` +
                `  Resolved path: ${resolved}`;
            logger.error(null, error);
            throw new Error(`Path '${filePath}' is outside the extension directory`);
        }

        return resolved;
    }

    /**
     * Get available tools description for LLM
     */
    static getToolsDescription(): string {
        return `You have access to the following tools to interact with extension files:

1. read_file(file_path: string): Read the content of a file
   - Returns: { success: boolean, content: string, error?: string }
   
2. write_file(file_path: string, content: string): Write content to a file
   - Returns: { success: boolean, error?: string }
   
3. list_files(directory: string): List files in a directory (optional, defaults to root)
   - Returns: { success: boolean, files: string[], error?: string }

To use a tool, respond with:
TOOL_CALL: <tool_name>
PARAMS: <JSON params>

Example:
TOOL_CALL: read_file
PARAMS: {"file_path": "background.js"}

After receiving the tool result, you can make more tool calls or provide your final fix.`;
    }
}
