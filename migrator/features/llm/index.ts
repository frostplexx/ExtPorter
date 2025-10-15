export { LLMService, ensureOllamaRunning, callLLMAPI } from './llm-service';
export { SSHTunnel } from './ssh-tunnel';
export type { LLMConfig, SSHConfig, RemoteLLMConfig, CommandResult, ChatMessage, GenerationOptions } from './types';
export { loadLLMConfig, loadSSHConfig, isSSHEnabled, getConfigSummary } from './config';
export {
    buildPromptFromFile,
    buildPromptFromString,
    validateTemplate,
    getTemplatePlaceholders,
    promptToChatMessages,
    buildChatMessagesFromFile
} from './prompt-template';
export type { PromptVariables } from './prompt-template';
