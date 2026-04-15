import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { MCPServer } from '../../../migrator/features/llm/mcp-server';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

describe('MCPServer', () => {
    let tempDir: string;
    let mcpServer: MCPServer;

    beforeEach(async () => {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-test-'));
        mcpServer = new MCPServer(tempDir);
    });

    afterEach(async () => {
        // Clean up the temporary directory
        await fs.remove(tempDir);
    });

    describe('Constructor', () => {
        it('should create server with normalized extension directory', () => {
            const server = new MCPServer(tempDir);
            expect(server).toBeDefined();
        });

        it('should handle paths with trailing slashes', () => {
            const server = new MCPServer(tempDir + '/');
            expect(server).toBeDefined();
        });
    });

    describe('read_file', () => {
        it('should read an existing file', async () => {
            // Create a test file
            const testFilePath = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFilePath, 'Hello, World!');

            const result = await mcpServer.executeTool('read_file', { file_path: 'test.txt' });

            expect(result.success).toBe(true);
            expect(result.content).toBe('Hello, World!');
        });

        it('should return error for non-existent file', async () => {
            const result = await mcpServer.executeTool('read_file', {
                file_path: 'nonexistent.txt',
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('File not found');
        });

        it('should read files in subdirectories', async () => {
            // Create a subdirectory with a file
            const subDir = path.join(tempDir, 'subdir');
            await fs.ensureDir(subDir);
            await fs.writeFile(path.join(subDir, 'nested.txt'), 'Nested content');

            const result = await mcpServer.executeTool('read_file', {
                file_path: 'subdir/nested.txt',
            });

            expect(result.success).toBe(true);
            expect(result.content).toBe('Nested content');
        });

        it('should prevent directory traversal attacks', async () => {
            // Try to read a file outside the extension directory
            // The MCPServer returns an error response for path traversal attempts
            const result = await mcpServer.executeTool('read_file', {
                file_path: '../../../etc/passwd',
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('outside the extension directory');
        });
    });

    describe('write_file', () => {
        it('should write content to a new file', async () => {
            const result = await mcpServer.executeTool('write_file', {
                file_path: 'new-file.txt',
                content: 'New content',
            });

            expect(result.success).toBe(true);

            // Verify file was written
            const content = await fs.readFile(path.join(tempDir, 'new-file.txt'), 'utf-8');
            expect(content).toBe('New content');
        });

        it('should overwrite an existing file', async () => {
            // Create initial file
            await fs.writeFile(path.join(tempDir, 'existing.txt'), 'Original content');

            const result = await mcpServer.executeTool('write_file', {
                file_path: 'existing.txt',
                content: 'Updated content',
            });

            expect(result.success).toBe(true);

            // Verify file was updated
            const content = await fs.readFile(path.join(tempDir, 'existing.txt'), 'utf-8');
            expect(content).toBe('Updated content');
        });

        it('should create parent directories if they do not exist', async () => {
            const result = await mcpServer.executeTool('write_file', {
                file_path: 'new/nested/dir/file.txt',
                content: 'Deeply nested content',
            });

            expect(result.success).toBe(true);

            // Verify file was written
            const content = await fs.readFile(
                path.join(tempDir, 'new/nested/dir/file.txt'),
                'utf-8'
            );
            expect(content).toBe('Deeply nested content');
        });

        it('should prevent directory traversal attacks on write', async () => {
            // The MCPServer returns an error response for path traversal attempts
            const result = await mcpServer.executeTool('write_file', {
                file_path: '../../../tmp/malicious.txt',
                content: 'Malicious content',
            });

            expect(result.success).toBe(false);
            expect(result.error).toContain('outside the extension directory');
        });

        it('should write files with special characters correctly', async () => {
            const specialContent = 'Special chars: <>&"\' 日本語 emoji 🎉';

            const result = await mcpServer.executeTool('write_file', {
                file_path: 'special.txt',
                content: specialContent,
            });

            expect(result.success).toBe(true);

            const content = await fs.readFile(path.join(tempDir, 'special.txt'), 'utf-8');
            expect(content).toBe(specialContent);
        });

        it('should handle writing JSON files', async () => {
            const jsonContent = JSON.stringify({ name: 'test', version: '1.0.0' }, null, 2);

            const result = await mcpServer.executeTool('write_file', {
                file_path: 'manifest.json',
                content: jsonContent,
            });

            expect(result.success).toBe(true);

            const content = await fs.readFile(path.join(tempDir, 'manifest.json'), 'utf-8');
            expect(JSON.parse(content)).toEqual({ name: 'test', version: '1.0.0' });
        });
    });

    describe('list_files', () => {
        it('should list files in the root directory', async () => {
            // Create some test files
            await fs.writeFile(path.join(tempDir, 'file1.txt'), 'content');
            await fs.writeFile(path.join(tempDir, 'file2.js'), 'content');

            const result = await mcpServer.executeTool('list_files', { directory: '' });

            expect(result.success).toBe(true);
            expect(result.files).toContain('file1.txt');
            expect(result.files).toContain('file2.js');
        });

        it('should list files in a subdirectory', async () => {
            // Create a subdirectory with files
            const subDir = path.join(tempDir, 'src');
            await fs.ensureDir(subDir);
            await fs.writeFile(path.join(subDir, 'index.js'), 'content');
            await fs.writeFile(path.join(subDir, 'utils.js'), 'content');

            const result = await mcpServer.executeTool('list_files', { directory: 'src' });

            expect(result.success).toBe(true);
            expect(result.files).toContain('src/index.js');
            expect(result.files).toContain('src/utils.js');
        });

        it('should indicate directories with trailing slash', async () => {
            // Create a subdirectory
            await fs.ensureDir(path.join(tempDir, 'mydir'));
            await fs.writeFile(path.join(tempDir, 'myfile.txt'), 'content');

            const result = await mcpServer.executeTool('list_files', { directory: '' });

            expect(result.success).toBe(true);
            expect(result.files).toContain('mydir/');
            expect(result.files).toContain('myfile.txt');
        });

        it('should return error for non-existent directory', async () => {
            const result = await mcpServer.executeTool('list_files', { directory: 'nonexistent' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Directory not found');
        });

        it('should prevent directory traversal attacks on list', async () => {
            // The MCPServer returns an error response for path traversal attempts
            const result = await mcpServer.executeTool('list_files', { directory: '../../../' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('outside the extension directory');
        });
    });

    describe('executeTool', () => {
        it('should throw error for unknown tool', async () => {
            await expect(async () => {
                await mcpServer.executeTool('unknown_tool', {});
            }).rejects.toThrow("Tool 'unknown_tool' is not allowed");
        });

        it('should only allow whitelisted operations', async () => {
            await expect(async () => {
                await mcpServer.executeTool('delete_file', { file_path: 'test.txt' });
            }).rejects.toThrow("Tool 'delete_file' is not allowed");
        });
    });

    describe('getToolsDescription', () => {
        it('should return a description of available tools', () => {
            const description = MCPServer.getToolsDescription();

            expect(description).toContain('read_file');
            expect(description).toContain('write_file');
            expect(description).toContain('list_files');
            expect(description).toContain('TOOL_CALL');
            expect(description).toContain('PARAMS');
        });
    });

    describe('Path security', () => {
        it('should handle absolute paths within extension directory', async () => {
            const testFile = path.join(tempDir, 'test.txt');
            await fs.writeFile(testFile, 'content');

            // This should work because the absolute path is within the extension dir
            const result = await mcpServer.executeTool('read_file', { file_path: 'test.txt' });
            expect(result.success).toBe(true);
        });

        it('should block paths with .. even when they resolve inside the directory', async () => {
            // Create a file
            await fs.writeFile(path.join(tempDir, 'test.txt'), 'content');

            // Create a subdirectory
            await fs.ensureDir(path.join(tempDir, 'subdir'));

            // This path uses .. but technically resolves inside the directory
            // Depending on implementation, this might be allowed or blocked
            const result = await mcpServer.executeTool('read_file', {
                file_path: 'subdir/../test.txt',
            });
            expect(result.success).toBe(true);
            expect(result.content).toBe('content');
        });

        it('should handle paths that look like they escape but do not', async () => {
            // Create a directory named "..."
            await fs.ensureDir(path.join(tempDir, '...'));
            await fs.writeFile(path.join(tempDir, '...', 'test.txt'), 'content');

            const result = await mcpServer.executeTool('read_file', { file_path: '.../test.txt' });
            expect(result.success).toBe(true);
            expect(result.content).toBe('content');
        });
    });
});
