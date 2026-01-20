import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
    ExtensionFixer,
    ExtensionFixContext,
} from '../../../migrator/features/llm/extension-fixer';
import { LLMService } from '../../../migrator/features/llm/llm-service';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Mock the copilot-auth module
jest.mock('../../../migrator/features/llm/copilot-auth', () => ({
    getCopilotHeaders: jest.fn<() => Promise<Record<string, string>>>().mockResolvedValue({
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/json',
    }),
    clearTokenCache: jest.fn(),
}));

// Mock the logger to avoid noise in tests
jest.mock('../../../migrator/utils/logger', () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    },
}));

describe('ExtensionFixer', () => {
    let tempDir: string;
    let mockLlmService: LLMService;

    beforeEach(async () => {
        // Create a temporary directory for testing
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ext-fixer-test-'));

        // Create a basic extension structure
        await fs.writeJSON(path.join(tempDir, 'manifest.json'), {
            name: 'Test Extension',
            version: '1.0.0',
            manifest_version: 3,
        });
        await fs.writeFile(path.join(tempDir, 'background.js'), 'console.log("background");');

        // Create mock LLM service
        mockLlmService = new LLMService({
            apiKey: '',
            model: 'gpt-4o',
        });
    });

    afterEach(async () => {
        // Clean up
        await fs.remove(tempDir);
        jest.clearAllMocks();
    });

    describe('Constructor', () => {
        it('should create an ExtensionFixer instance', () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension', version: '1.0.0' },
                report: { overall_working: 'no' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            expect(fixer).toBeDefined();
        });
    });

    describe('fromExtension', () => {
        it('should create ExtensionFixer from extension document with manifest_v3_path', async () => {
            const extension = {
                id: 'test-123',
                name: 'Test Extension',
                manifest_v3_path: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension', version: '1.0.0' },
            };

            const report = { overall_working: 'no' };

            const fixer = await ExtensionFixer.fromExtension(mockLlmService, extension, report);
            expect(fixer).toBeDefined();
        });

        it('should create ExtensionFixer from extension document with directory path', async () => {
            const extension = {
                id: 'test-123',
                name: 'Test Extension',
                manifest_v3_path: tempDir, // Just the directory, not the manifest file
                manifest: { name: 'Test Extension', version: '1.0.0' },
            };

            const report = { overall_working: 'no' };

            const fixer = await ExtensionFixer.fromExtension(mockLlmService, extension, report);
            expect(fixer).toBeDefined();
        });

        it('should fall back to manifest_v2_path if manifest_v3_path is not set', async () => {
            const extension = {
                id: 'test-123',
                name: 'Test Extension',
                manifest_v2_path: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension', version: '1.0.0' },
            };

            const report = { overall_working: 'no' };

            const fixer = await ExtensionFixer.fromExtension(mockLlmService, extension, report);
            expect(fixer).toBeDefined();
        });

        it('should throw error if no manifest path is provided', async () => {
            const extension = {
                id: 'test-123',
                name: 'Test Extension',
            };

            const report = { overall_working: 'no' };

            await expect(
                ExtensionFixer.fromExtension(mockLlmService, extension, report)
            ).rejects.toThrow('Extension does not have a manifest path');
        });

        it('should read manifest from disk if not in extension document', async () => {
            const extension = {
                id: 'test-123',
                name: 'Test Extension',
                manifest_v3_path: path.join(tempDir, 'manifest.json'),
                // No manifest property
            };

            const report = { overall_working: 'no' };

            const fixer = await ExtensionFixer.fromExtension(mockLlmService, extension, report);
            expect(fixer).toBeDefined();
        });
    });

    describe('parseToolCalls', () => {
        it('should parse single tool call from response', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);

            // Access private method through any
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            const response = `
Let me read the background file.

TOOL_CALL: read_file
PARAMS: {"file_path": "background.js"}
`;

            const toolCalls = parseToolCalls(response);

            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].name).toBe('read_file');
            expect(toolCalls[0].params.file_path).toBe('background.js');
        });

        it('should parse multiple tool calls from response', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            const response = `
I'll read the manifest and background.

TOOL_CALL: read_file
PARAMS: {"file_path": "manifest.json"}

TOOL_CALL: read_file
PARAMS: {"file_path": "background.js"}
`;

            const toolCalls = parseToolCalls(response);

            expect(toolCalls).toHaveLength(2);
            expect(toolCalls[0].params.file_path).toBe('manifest.json');
            expect(toolCalls[1].params.file_path).toBe('background.js');
        });

        it('should parse write_file tool call with content', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            const response = `
I'll fix the background script.

TOOL_CALL: write_file
PARAMS: {"file_path": "background.js", "content": "// Fixed\\nconsole.log('fixed');"}
`;

            const toolCalls = parseToolCalls(response);

            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].name).toBe('write_file');
            expect(toolCalls[0].params.file_path).toBe('background.js');
            expect(toolCalls[0].params.content).toContain('Fixed');
        });

        it('should handle malformed JSON gracefully', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            const response = `
TOOL_CALL: read_file
PARAMS: {invalid json}
`;

            const toolCalls = parseToolCalls(response);

            // Should return empty array since JSON parsing failed
            expect(toolCalls).toHaveLength(0);
        });

        it('should parse write_file with code containing nested braces', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            // This simulates the real LLM output with nested braces in code
            const response = `
I'll fix the background script.

TOOL_CALL: write_file
PARAMS: {"file_path": "background.js", "content": "function test() {\\n  if (true) {\\n    console.log('nested');\\n  }\\n}"}

TOOL_CALL: read_file
PARAMS: {"file_path": "manifest.json"}
`;

            const toolCalls = parseToolCalls(response);

            expect(toolCalls).toHaveLength(2);
            expect(toolCalls[0].name).toBe('write_file');
            expect(toolCalls[0].params.file_path).toBe('background.js');
            expect(toolCalls[0].params.content).toContain('function test()');
            expect(toolCalls[0].params.content).toContain('nested');
            expect(toolCalls[1].name).toBe('read_file');
            expect(toolCalls[1].params.file_path).toBe('manifest.json');
        });

        it('should parse multiple write_file calls with complex code', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            const response = `
TOOL_CALL: write_file
PARAMS: {"file_path": "a.js", "content": "const obj = { a: { b: 1 } };"}

TOOL_CALL: write_file
PARAMS: {"file_path": "b.js", "content": "function f() { return { x: 1 }; }"}

DONE
SUMMARY: Fixed both files.
`;

            const toolCalls = parseToolCalls(response);

            expect(toolCalls).toHaveLength(2);
            expect(toolCalls[0].params.file_path).toBe('a.js');
            expect(toolCalls[0].params.content).toContain('const obj');
            expect(toolCalls[1].params.file_path).toBe('b.js');
            expect(toolCalls[1].params.content).toContain('function f()');
        });

        it('should handle JSON with escaped quotes in content', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const parseToolCalls = (fixer as any).parseToolCalls.bind(fixer);

            const response = `
TOOL_CALL: write_file
PARAMS: {"file_path": "test.js", "content": "console.log(\\"Hello, World!\\");"}
`;

            const toolCalls = parseToolCalls(response);

            expect(toolCalls).toHaveLength(1);
            expect(toolCalls[0].params.content).toBe('console.log("Hello, World!");');
        });
    });

    describe('extractSummary', () => {
        it('should extract summary from DONE response', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const extractSummary = (fixer as any).extractSummary.bind(fixer);

            const response = `
DONE
SUMMARY: Fixed the background script to use the new API.
`;

            const summary = extractSummary(response);

            expect(summary).toBe('Fixed the background script to use the new API.');
        });

        it('should return default summary when SUMMARY is not found', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const extractSummary = (fixer as any).extractSummary.bind(fixer);

            const response = `
DONE

That's all the changes needed.
`;

            const summary = extractSummary(response);

            expect(summary).toBe('Extension fixed successfully');
        });
    });

    describe('buildReportSummary', () => {
        it('should include overall status', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { overall_working: 'no' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const buildReportSummary = (fixer as any).buildReportSummary.bind(fixer);

            const summary = buildReportSummary();

            expect(summary).toContain('Overall Status: no');
        });

        it('should include install failure', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { installs: false },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const buildReportSummary = (fixer as any).buildReportSummary.bind(fixer);

            const summary = buildReportSummary();

            expect(summary).toContain('Extension does not install successfully');
        });

        it('should include popup not working', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { is_popup_working: false },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const buildReportSummary = (fixer as any).buildReportSummary.bind(fixer);

            const summary = buildReportSummary();

            expect(summary).toContain('Popup is not working');
        });

        it('should include listener status', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {
                    listeners: [
                        {
                            api: 'chrome.runtime.onInstalled',
                            file: 'background.js',
                            line: 10,
                            status: 'yes',
                        },
                        {
                            api: 'chrome.tabs.onUpdated',
                            file: 'background.js',
                            line: 20,
                            status: 'no',
                        },
                    ],
                },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const buildReportSummary = (fixer as any).buildReportSummary.bind(fixer);

            const summary = buildReportSummary();

            expect(summary).toContain('Event Listeners Status');
            expect(summary).toContain('chrome.runtime.onInstalled');
            expect(summary).toContain('chrome.tabs.onUpdated');
        });

        it('should include notes', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { notes: 'The popup crashes on load' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            const buildReportSummary = (fixer as any).buildReportSummary.bind(fixer);

            const summary = buildReportSummary();

            expect(summary).toContain('Additional Notes');
            expect(summary).toContain('The popup crashes on load');
        });
    });

    describe('cleanup', () => {
        it('should clear all internal state', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: {},
            };

            const fixer = new ExtensionFixer(mockLlmService, context);

            // Access private fields to verify cleanup
            (fixer as any).conversationHistory.push({ role: 'user', content: 'test' });
            (fixer as any).toolCallHistory.push({ tool: 'test', params: {} });
            (fixer as any).fileDiffs.push({ filePath: 'test', before: '', after: '' });
            (fixer as any).fileContentCache.set('test', 'content');

            fixer.cleanup();

            expect((fixer as any).conversationHistory).toHaveLength(0);
            expect((fixer as any).toolCallHistory).toHaveLength(0);
            expect((fixer as any).fileDiffs).toHaveLength(0);
            expect((fixer as any).fileContentCache.size).toBe(0);
        });
    });

    describe('fixExtension (integration)', () => {
        it('should handle immediate DONE response', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { overall_working: 'yes' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);

            // Mock LLM to return DONE immediately
            jest.spyOn(mockLlmService, 'generateChatCompletion').mockResolvedValue(`
The extension looks fine. No changes needed.

DONE
SUMMARY: Extension already working correctly.
`);

            const result = await fixer.fixExtension();

            expect(result.success).toBe(true);
            expect(result.message).toContain('Extension already working correctly');
            expect(result.filesModified).toHaveLength(0);
            expect(result.fixAttempt).toBeDefined();
            expect(result.fixAttempt?.extension_id).toBe('test-123');
        });

        it('should execute tool calls and track modifications', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { overall_working: 'no' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);

            let callCount = 0;
            jest.spyOn(mockLlmService, 'generateChatCompletion').mockImplementation(async () => {
                callCount++;
                if (callCount === 1) {
                    return `
I'll read the background script first.

TOOL_CALL: read_file
PARAMS: {"file_path": "background.js"}
`;
                } else if (callCount === 2) {
                    return `
Now I'll fix it.

TOOL_CALL: write_file
PARAMS: {"file_path": "background.js", "content": "// Fixed\\nconsole.log('fixed');"}
`;
                } else {
                    return `
DONE
SUMMARY: Fixed the background script.
`;
                }
            });

            const result = await fixer.fixExtension();

            expect(result.success).toBe(true);
            expect(result.filesModified).toContain('background.js');

            // Verify file was actually written
            const content = await fs.readFile(path.join(tempDir, 'background.js'), 'utf-8');
            expect(content).toContain('Fixed');

            // Verify fix attempt record
            expect(result.fixAttempt).toBeDefined();
            expect(result.fixAttempt?.files_modified).toContain('background.js');
            expect(result.fixAttempt?.iterations).toBeGreaterThan(0);
        });

        it('should return failure on max iterations', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { overall_working: 'no' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);
            // Reduce max iterations for test
            (fixer as any).maxIterations = 2;

            // Mock LLM to never return DONE
            jest.spyOn(mockLlmService, 'generateChatCompletion').mockResolvedValue(`
I'm still analyzing...

TOOL_CALL: list_files
PARAMS: {"directory": ""}
`);

            const result = await fixer.fixExtension();

            expect(result.success).toBe(false);
            expect(result.error).toContain('iteration limit');
        });

        it('should handle LLM errors gracefully', async () => {
            const context: ExtensionFixContext = {
                extensionId: 'test-123',
                extensionName: 'Test Extension',
                extensionDir: tempDir,
                manifestPath: path.join(tempDir, 'manifest.json'),
                manifest: { name: 'Test Extension' },
                report: { overall_working: 'no' },
            };

            const fixer = new ExtensionFixer(mockLlmService, context);

            // Mock LLM to throw error
            jest.spyOn(mockLlmService, 'generateChatCompletion').mockRejectedValue(
                new Error('API rate limit exceeded')
            );

            const result = await fixer.fixExtension();

            expect(result.success).toBe(false);
            expect(result.error).toContain('API rate limit exceeded');
            expect(result.fixAttempt).toBeDefined();
            expect(result.fixAttempt?.success).toBe(false);
        });
    });
});
