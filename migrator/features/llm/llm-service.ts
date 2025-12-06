import * as https from 'https';
import * as http from 'http';
import { CopilotConfig, ChatMessage, GenerationOptions } from './types';
import { loadLLMConfig } from './config';
import { logger } from '../../utils/logger';

export class LLMService {
    private config: CopilotConfig;

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
     * Initialize the service (no-op for Copilot API, kept for compatibility)
     */
    async initialize(): Promise<void> {
        // Validate API key
        if (!this.config.apiKey) {
            throw new Error(
                'GitHub API token not configured. Set GITHUB_TOKEN or COPILOT_API_KEY environment variable.'
            );
        }

        logger.info(null, `Using GitHub Copilot API with model: ${this.config.model}`);
    }

    /**
     * Cleanup resources (no-op for Copilot API, kept for compatibility)
     */
    async cleanup(): Promise<void> {
        // No cleanup needed for HTTP-based API
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

        return new Promise((resolve, reject) => {
            // Parse endpoint URL
            const endpoint = this.config.endpoint || 'https://api.githubcopilot.com';
            const url = new URL(`${endpoint}/chat/completions`);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

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
                stream: true, // Enable streaming for live output
            };

            const data = JSON.stringify(requestBody);

            const requestOptions = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                    Authorization: `Bearer ${this.config.apiKey}`,
                    'User-Agent': 'ExtPorter-LLM-Client/1.0',
                },
            };

            const req = httpModule.request(requestOptions, (res: any) => {
                let fullResponse = '';
                let buffer = '';
                let resolved = false;

                // Check for error status codes
                if (res.statusCode && res.statusCode >= 400) {
                    let errorBody = '';
                    res.on('data', (chunk: any) => {
                        errorBody += chunk.toString();
                    });
                    res.on('end', () => {
                        clearTimeout(timeout);
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

                res.on('data', (chunk: any) => {
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
                        } catch (e) {
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
                        } catch (e) {
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

                res.on('error', (error: any) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });

            req.on('error', (error: any) => {
                clearTimeout(timeout);
                if (error.code === 'ENOTFOUND') {
                    reject(
                        new Error(
                            `Could not connect to GitHub Copilot API at ${url.hostname}. Check your network connection and endpoint configuration.`
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
     * Check if the service is properly configured
     */
    isConfigured(): boolean {
        return !!this.config.apiKey;
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
