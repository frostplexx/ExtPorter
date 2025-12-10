// Dynamic imports for ESM-only @opencode-ai/sdk package
// These will be loaded lazily when the service is initialized
let createOpencode: any;
let createOpencodeClient: any;

import { ChatMessage, GenerationOptions, OpencodeConfig } from './types';
import { logger } from '../../utils/logger';

/**
 * Load the OpenCode SDK dynamically (ESM-only package)
 */
async function loadSdk(): Promise<void> {
    if (!createOpencode || !createOpencodeClient) {
        const sdk = await import('@opencode-ai/sdk');
        createOpencode = sdk.createOpencode;
        createOpencodeClient = sdk.createOpencodeClient;
    }
}

/**
 * LLM Service implementation using OpenCode SDK
 * This provides a bridge between ExtPorter and OpenCode's LLM capabilities
 */
export class OpencodeService {
    private config: OpencodeConfig;
    private client: any;
    private sessionId: string | null = null;
    private serverInstance: any = null;

    constructor(config: OpencodeConfig) {
        this.config = {
            temperature: 0.2,
            max_tokens: 4000,
            top_p: 0.85,
            port: 4096,
            hostname: '127.0.0.1',
            ...config,
        };
    }

    /**
     * Create an OpencodeService instance from environment variables
     */
    static fromEnv(): OpencodeService {
        const config: OpencodeConfig = {
            model: process.env.LLM_MODEL || 'anthropic/claude-3-5-sonnet-20241022',
            temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.2'),
            max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '4000', 10),
            top_p: parseFloat(process.env.LLM_TOP_P || '0.85'),
            port: parseInt(process.env.OPENCODE_PORT || '4096', 10),
            hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
            useExternalServer:
                process.env.OPENCODE_USE_EXTERNAL === 'true' ||
                process.env.OPENCODE_USE_EXTERNAL === '1',
        };

        return new OpencodeService(config);
    }

    /**
     * Initialize the service by starting OpenCode server or connecting to existing one
     */
    async initialize(): Promise<void> {
        // Load SDK dynamically (ESM-only package)
        await loadSdk();

        try {
            if (this.config.useExternalServer) {
                // Connect to existing OpenCode instance
                logger.info(
                    null,
                    `Connecting to existing OpenCode server at ${this.config.hostname}:${this.config.port}`
                );
                this.client = createOpencodeClient({
                    baseUrl: `http://${this.config.hostname}:${this.config.port}`,
                });
            } else {
                // Start new OpenCode server instance
                logger.info(null, 'Starting OpenCode server...');
                const opencode = await createOpencode({
                    hostname: this.config.hostname,
                    port: this.config.port,
                    config: {
                        model: this.config.model,
                    },
                });

                this.client = opencode.client;
                this.serverInstance = opencode.server;
                logger.info(null, `OpenCode server running at ${opencode.server.url}`);
            }

            // Create a session for this instance
            const session = await this.client.session.create({
                body: {
                    title: 'ExtPorter LLM Session',
                },
            });

            this.sessionId = session.data.id;
            logger.info(null, `OpenCode session created: ${this.sessionId}`);
            logger.info(null, `Using model: ${this.config.model}`);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'Unknown error during initialization';
            throw new Error(`Failed to initialize OpenCode service: ${message}`);
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        try {
            // Delete session if it exists
            if (this.sessionId && this.client) {
                await this.client.session.delete({
                    path: { id: this.sessionId },
                });
                logger.info(null, `OpenCode session ${this.sessionId} deleted`);
                this.sessionId = null;
            }

            // Close server if we started it
            if (this.serverInstance) {
                this.serverInstance.close();
                logger.info(null, 'OpenCode server closed');
                this.serverInstance = null;
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error during cleanup';
            logger.warn(null, `Error during cleanup: ${message}`);
        }
    }

    /**
     * Generate completion using chat messages via OpenCode
     */
    async generateChatCompletion(
        messages: ChatMessage[],
        options: GenerationOptions = {}
    ): Promise<string> {
        const { streamToConsole = true } = options;

        if (!this.client || !this.sessionId) {
            throw new Error('OpenCode service not initialized. Call initialize() first.');
        }

        try {
            // Parse model string (format: "provider/model")
            const [providerID, modelID] = this.parseModelString(this.config.model);

            // Convert messages to OpenCode parts format
            const parts = messages.map((msg) => ({
                type: 'text' as const,
                text: `[${msg.role}]: ${msg.content}`,
            }));

            // Send prompt to OpenCode session
            const result = await this.client.session.prompt({
                path: { id: this.sessionId },
                body: {
                    model: { providerID, modelID },
                    parts,
                },
            });

            // Extract response from assistant message
            const response = this.extractResponse(result.data);

            if (streamToConsole) {
                console.log(response);
            }

            return response;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            throw new Error(`Failed to generate completion: ${message}`);
        }
    }

    /**
     * Legacy completion API - converts to chat format
     */
    async generateCompletion(prompt: string, streamToConsole: boolean = true): Promise<string> {
        const messages: ChatMessage[] = [
            {
                role: 'user',
                content: prompt,
            },
        ];

        return this.generateChatCompletion(messages, { streamToConsole });
    }

    /**
     * Get the current model being used
     */
    getModel(): string {
        return this.config.model;
    }

    /**
     * Check if the service is properly configured
     */
    isConfigured(): boolean {
        return !!this.config.model;
    }

    /**
     * Parse model string in format "provider/model"
     */
    private parseModelString(model: string): [string, string] {
        const parts = model.split('/');
        if (parts.length !== 2) {
            throw new Error(
                `Invalid model format: ${model}. Expected format: "provider/model" (e.g., "anthropic/claude-3-5-sonnet-20241022")`
            );
        }
        return [parts[0], parts[1]];
    }

    /**
     * Extract text response from OpenCode message parts
     */
    private extractResponse(messageData: any): string {
        if (!messageData || !messageData.parts) {
            throw new Error('Invalid response from OpenCode');
        }

        // Concatenate all text parts
        const textParts = messageData.parts
            .filter((part: any) => part.type === 'text')
            .map((part: any) => part.text)
            .join('\n');

        if (!textParts) {
            throw new Error('No text content in OpenCode response');
        }

        return textParts;
    }
}

// Legacy function export for backwards compatibility
export async function callLLMAPI(prompt: string): Promise<string> {
    const service = OpencodeService.fromEnv();
    await service.initialize();
    try {
        const result = await service.generateCompletion(prompt);
        return result;
    } finally {
        await service.cleanup();
    }
}
