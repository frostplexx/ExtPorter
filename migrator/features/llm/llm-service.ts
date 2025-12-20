import * as https from 'https';
import { CopilotConfig, ChatMessage, GenerationOptions } from './types';
import { loadLLMConfig } from './config';
import { logger } from '../../utils/logger';
import { getCopilotHeaders, clearTokenCache } from './copilot-auth';

const COPILOT_API_ENDPOINT = 'https://api.githubcopilot.com';

export class LLMService {
    private config: CopilotConfig;
    private cachedHeaders: Record<string, string> | null = null;

    constructor(config: CopilotConfig) {
        this.config = {
            temperature: 0.2,
            max_tokens: 4000,
            top_p: 0.85,
            ...config,
        };
    }

    /**
     * Create an LLMService instance from environment variables
     */
    static fromEnv(): LLMService {
        const config = loadLLMConfig();
        return new LLMService(config);
    }

    /**
     * Initialize the service - authenticates with GitHub Copilot
     */
    async initialize(): Promise<void> {
        try {
            // Get and cache the Copilot headers (this will trigger auth if needed)
            this.cachedHeaders = await getCopilotHeaders();
            logger.info(null, `Using GitHub Copilot API with model: ${this.config.model}`);
        } catch (error) {
            throw new Error(`Failed to initialize GitHub Copilot: ${error}`);
        }
    }

    /**
     * Cleanup resources
     */
    async cleanup(): Promise<void> {
        this.cachedHeaders = null;
    }

    /**
     * Get headers for API requests, refreshing if needed
     */
    private async getHeaders(): Promise<Record<string, string>> {
        if (!this.cachedHeaders) {
            this.cachedHeaders = await getCopilotHeaders();
        }
        return this.cachedHeaders;
    }

    /**
     * Generate completion using chat messages
     * Uses the GitHub Copilot Chat Completions API
     */
    async generateChatCompletion(
        messages: ChatMessage[],
        options: GenerationOptions = {}
    ): Promise<string> {
        const { streamToConsole = true } = options;

        // Get fresh headers (handles token refresh)
        let headers: Record<string, string>;
        try {
            headers = await this.getHeaders();
        } catch (error) {
            throw new Error(`Authentication failed: ${error}`);
        }

        return new Promise((resolve, reject) => {
            const url = new URL(`${COPILOT_API_ENDPOINT}/chat/completions`);

            // Set a timeout (5 minutes for longer responses)
            const timeout = setTimeout(() => {
                req.destroy();
                reject(
                    new Error(
                        'Request timed out after 5 minutes. The model might be too slow or the prompt too large.'
                    )
                );
            }, 300000);

            // GitHub Copilot API format (OpenAI-compatible)
            const requestBody = {
                model: this.config.model,
                messages: messages,
                temperature: this.config.temperature,
                max_tokens: this.config.max_tokens,
                top_p: this.config.top_p,
                n: 1,
                stream: true, // Enable streaming for live output
            };

            const data = JSON.stringify(requestBody);

            const requestOptions: https.RequestOptions = {
                hostname: url.hostname,
                port: 443,
                path: url.pathname,
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Length': Buffer.byteLength(data).toString(),
                },
            };

            const req = https.request(requestOptions, (res) => {
                let fullResponse = '';
                let buffer = '';
                let resolved = false;

                // Check for error status codes
                if (res.statusCode && res.statusCode >= 400) {
                    let errorBody = '';
                    res.on('data', (chunk) => {
                        errorBody += chunk.toString();
                    });
                    res.on('end', () => {
                        clearTimeout(timeout);

                        // If we get auth errors, clear the cache and suggest retry
                        if (res.statusCode === 401 || res.statusCode === 403) {
                            this.cachedHeaders = null;
                            clearTokenCache();
                        }

                        try {
                            const errorJson = JSON.parse(errorBody);
                            reject(
                                new Error(
                                    `API error (${res.statusCode}): ${errorJson.error?.message || errorBody}`
                                )
                            );
                        } catch {
                            reject(new Error(`API error (${res.statusCode}): ${errorBody}`));
                        }
                    });
                    return;
                }

                res.on('data', (chunk) => {
                    buffer += chunk.toString();

                    // Process each line (SSE format: "data: {...}\n\n")
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim() || line.trim() === 'data: [DONE]') continue;

                        // Remove "data: " prefix
                        const jsonLine = line.replace(/^data: /, '').trim();
                        if (!jsonLine) continue;

                        try {
                            const parsed = JSON.parse(jsonLine);
                            const content = parsed.choices?.[0]?.delta?.content;

                            if (content) {
                                if (streamToConsole) {
                                    process.stdout.write(content);
                                }
                                fullResponse += content;
                            }

                            // Check if done
                            if (parsed.choices?.[0]?.finish_reason && !resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                if (streamToConsole) {
                                    console.log('\n');
                                }
                                resolve(fullResponse);
                            }
                        } catch {
                            // Skip invalid JSON lines (comments, etc.)
                            logger.debug(null, `Skipping non-JSON line: ${jsonLine}`);
                        }
                    }
                });

                res.on('end', () => {
                    if (resolved) return;

                    clearTimeout(timeout);

                    // Process any remaining buffer
                    if (buffer.trim() && buffer.trim() !== 'data: [DONE]') {
                        const jsonLine = buffer.replace(/^data: /, '').trim();
                        try {
                            const parsed = JSON.parse(jsonLine);
                            const content = parsed.choices?.[0]?.delta?.content;
                            if (content) {
                                if (streamToConsole) {
                                    process.stdout.write(content);
                                }
                                fullResponse += content;
                            }
                        } catch {
                            logger.debug(null, `Skipping final buffer: ${jsonLine}`);
                        }
                    }

                    if (fullResponse) {
                        if (streamToConsole) {
                            console.log('\n');
                        }
                        resolve(fullResponse);
                    } else {
                        reject(new Error('Empty response from LLM'));
                    }
                });

                res.on('error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            req.on('error', (error: NodeJS.ErrnoException) => {
                clearTimeout(timeout);
                if (error.code === 'ENOTFOUND') {
                    reject(
                        new Error(
                            `Could not connect to GitHub Copilot API at ${url.hostname}. Check your network connection.`
                        )
                    );
                } else {
                    reject(error);
                }
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Legacy completion API - converts to chat format
     * For better results, use generateChatCompletion() instead
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
     * Check if the service is properly configured (always true for Copilot, auth is handled separately)
     */
    isConfigured(): boolean {
        return true;
    }
}

// Legacy function exports for backwards compatibility
export async function callLLMAPI(prompt: string): Promise<string> {
    const service = LLMService.fromEnv();
    await service.initialize();
    const result = await service.generateCompletion(prompt);
    await service.cleanup();
    return result;
}
