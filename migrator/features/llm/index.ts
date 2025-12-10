// GitHub Copilot API exports
export { LLMService, callLLMAPI } from './llm-service';
export { loadLLMConfig, getConfigSummary } from './config';
export {
    getCopilotHeaders,
    getCopilotSessionToken,
    getGitHubOAuthToken,
    clearTokenCache,
} from './copilot-auth';
export { llmManager } from './llm-manager';

// OpenCode SDK exports
export { OpencodeService, callLLMAPI as callOpencodeAPI } from './opencode-service';
export { loadOpencodeConfig, getOpencodeConfigSummary } from './opencode-config';
export { opencodeManager } from './opencode-manager';

// Shared types and utilities
export type { CopilotConfig, OpencodeConfig, ChatMessage, GenerationOptions } from './types';
export {
    buildPromptFromFile,
    buildPromptFromString,
    validateTemplate,
    getTemplatePlaceholders,
    promptToChatMessages,
    buildChatMessagesFromFile,
} from './prompt-template';
export type { PromptVariables } from './prompt-template';
export { MCPServer } from './mcp-server';
export { ExtensionFixer } from './extension-fixer';
export type { ExtensionFixContext, FixResult } from './extension-fixer';
