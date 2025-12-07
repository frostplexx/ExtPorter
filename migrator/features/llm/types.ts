export interface LLMConfig {
    model: string;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
}

export interface CopilotConfig extends LLMConfig {
    apiKey: string; // Deprecated: Authentication is now handled automatically by copilot-auth.ts
    endpoint?: string; // Deprecated: Always uses https://api.githubcopilot.com
}

export type RemoteLLMConfig = CopilotConfig;

/**
 * OpenCode configuration
 */
export interface OpencodeConfig extends LLMConfig {
    port?: number;
    hostname?: string;
    useExternalServer?: boolean; // If true, connect to existing OpenCode instance
}

export interface CommandResult {
    success: boolean;
    output: string;
    error?: string;
}

/**
 * Chat message for the chat API
 */
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

/**
 * Options for LLM generation
 */
export interface GenerationOptions {
    /** Use chat API (/api/chat) instead of completion API (/api/generate) */
    useChat?: boolean;
    /** Stream output to console */
    streamToConsole?: boolean;
}
