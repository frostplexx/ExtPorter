import * as https from 'https';
import * as http from 'http';
import chalk from 'chalk';
import { spawn } from 'child_process';
import { RemoteLLMConfig, CommandResult, ChatMessage, GenerationOptions } from './types';
import { SSHTunnel } from './ssh-tunnel';
import { loadLLMConfig } from './config';
import { logger } from '../../utils/logger';

export class LLMService {
    private config: RemoteLLMConfig;
    private sshTunnel: SSHTunnel | null = null;
    private effectiveEndpoint: string;

    constructor(config: RemoteLLMConfig) {
        this.config = {
            temperature: 0.2,
            num_predict: 4000,
            top_p: 0.85,
            top_k: 30,
            ...config
        };
        this.effectiveEndpoint = config.endpoint;
    }

    /**
     * Create an LLMService instance from environment variables
     */
    static fromEnv(): LLMService {
        const config = loadLLMConfig();
        return new LLMService(config);
    }

    /**
     * Initialize the service, establishing SSH tunnel if configured
     */
    async initialize(): Promise<void> {
        if (this.config.ssh) {
            this.sshTunnel = new SSHTunnel(this.config.ssh);
            await this.sshTunnel.connect();

            // Update endpoint to use local tunnel
            const url = new URL(this.config.endpoint);
            url.hostname = 'localhost';
            url.port = this.config.ssh.localPort.toString();
            this.effectiveEndpoint = url.toString();
        }

        // Ensure Ollama is running and model is available
        await this.ensureOllamaRunning();
    }

    /**
     * Cleanup resources, closing SSH tunnel if active
     */
    async cleanup(): Promise<void> {
        if (this.sshTunnel) {
            this.sshTunnel.disconnect();
            this.sshTunnel = null;
        }
    }

    /**
     * Ensure Ollama is running and the specified model is available
     * When using SSH tunnel, skip local Ollama checks as it's running remotely
     */
    private async ensureOllamaRunning(): Promise<boolean> {
        // Skip local Ollama checks when using SSH tunnel (Ollama is running remotely)
        if (this.config.ssh) {
            return true;
        }

        try {
            // Check if Ollama is running by trying to list models
            const checkResult = await this.runCommand('ollama', ['list'], false);

            if (checkResult.success) {
                // Check if model is available
                if (checkResult.output.includes(this.config.model)) {
                    return true;
                } else {
                    // Model not found, try to pull it
                    console.log(chalk.yellow(`⚠ Model '${this.config.model}' not found`));
                    console.log(chalk.dim(`Downloading model '${this.config.model}'... (this may take a few minutes)`));

                    const pullResult = await this.runCommand('ollama', ['pull', this.config.model], true);

                    if (pullResult.success) {
                        console.log(chalk.green(`✓ Model '${this.config.model}' downloaded successfully`));
                        return true;
                    } else {
                        console.log(chalk.red(`✗ Failed to download model: ${pullResult.error}`));
                        return false;
                    }
                }
            } else {
                // Ollama not running, try to start it
                console.log(chalk.yellow('⚠ Ollama not running, attempting to start...'));

                // Try to start Ollama in the background
                await this.runCommand('ollama', ['serve'], false, true);

                // Wait a bit for Ollama to start
                await new Promise(resolve => setTimeout(resolve, 2000));

                // Check again
                const recheckResult = await this.runCommand('ollama', ['list'], false);

                if (recheckResult.success) {
                    console.log(chalk.green('✓ Ollama started successfully'));

                    // Now check/download the model
                    if (!recheckResult.output.includes(this.config.model)) {
                        console.log(chalk.dim(`Downloading model '${this.config.model}'... (this may take a few minutes)`));
                        const pullResult = await this.runCommand('ollama', ['pull', this.config.model], true);

                        if (!pullResult.success) {
                            console.log(chalk.red(`✗ Failed to download model: ${pullResult.error}`));
                            return false;
                        }
                        console.log(chalk.green(`✓ Model '${this.config.model}' downloaded successfully`));
                    }
                    return true;
                } else {
                    return false;
                }
            }
        } catch (error: any) {
            console.log(chalk.red(`✗ Error checking Ollama: ${error.message}`));
            return false;
        }
    }

    /**
     * Run a command and return the result
     */
    private async runCommand(
        command: string,
        args: string[],
        showOutput: boolean = false,
        background: boolean = false
    ): Promise<CommandResult> {
        return new Promise((resolve) => {
            try {
                if (background) {
                    // Run in background
                    const proc = spawn(command, args, {
                        detached: true,
                        stdio: 'ignore'
                    });
                    proc.unref();
                    resolve({ success: true, output: '' });
                    return;
                }

                const proc = spawn(command, args, {
                    stdio: showOutput ? 'inherit' : 'pipe'
                });

                let output = '';
                let error = '';

                if (!showOutput) {
                    proc.stdout?.on('data', (data) => {
                        output += data.toString();
                    });

                    proc.stderr?.on('data', (data) => {
                        error += data.toString();
                    });
                }

                proc.on('close', (code) => {
                    resolve({
                        success: code === 0,
                        output,
                        error: error || undefined
                    });
                });

                proc.on('error', (err) => {
                    resolve({
                        success: false,
                        output: '',
                        error: err.message
                    });
                });
            } catch (err: any) {
                resolve({
                    success: false,
                    output: '',
                    error: err.message
                });
            }
        });
    }

    /**
     * Generate completion using chat messages (recommended)
     * Uses the /api/chat endpoint which properly separates system/user messages
     */
    async generateChatCompletion(messages: ChatMessage[], options: GenerationOptions = {}): Promise<string> {
        const { streamToConsole = true } = options;

        return new Promise((resolve, reject) => {
            // Parse endpoint URL
            const url = new URL(this.effectiveEndpoint);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            // Set a timeout (3 minutes)
            const timeout = setTimeout(() => {
                req.destroy();
                reject(new Error('Request timed out after 3 minutes. The model might be too slow or the prompt too large.'));
            }, 180000);

            // Ollama chat API format
            const data = JSON.stringify({
                model: this.config.model,
                messages: messages,
                stream: true,
                options: {
                    temperature: this.config.temperature,
                    num_predict: this.config.num_predict,
                    top_p: this.config.top_p,
                    top_k: this.config.top_k,
                }
            });

            const options_req = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: '/api/chat',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            };

            const req = httpModule.request(options_req, (res: any) => {
                let fullResponse = '';
                let buffer = '';
                let resolved = false;

                res.on('data', (chunk: any) => {
                    buffer += chunk.toString();

                    // Process each line (streaming responses come line by line as JSON)
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.message?.content) {
                                if (streamToConsole) {
                                    process.stdout.write(parsed.message.content);
                                }
                                fullResponse += parsed.message.content;
                            }

                            if (parsed.done && !resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                if (streamToConsole) {
                                    console.log('\n');
                                }
                                resolve(fullResponse);
                            }
                        } catch (e) {
                            logger.error(null, e as any);
                            
                            // Skip invalid JSON lines
                        }
                    }
                });

                res.on('end', () => {
                    if (resolved) return;

                    clearTimeout(timeout);

                    if (buffer.trim()) {
                        try {
                            const parsed = JSON.parse(buffer);
                            if (parsed.message?.content) {
                                if (streamToConsole) {
                                    process.stdout.write(parsed.message.content);
                                }
                                fullResponse += parsed.message.content;
                            }
                        } catch (e) {
                            logger.error(null, e as any);
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
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Call the LLM API with the given prompt (legacy completion API)
     * For better results, use generateChatCompletion() instead
     */
    async generateCompletion(prompt: string, streamToConsole: boolean = true): Promise<string> {
        return new Promise((resolve, reject) => {
            // Parse endpoint URL
            const url = new URL(this.effectiveEndpoint);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            // Set a timeout (3 minutes)
            const timeout = setTimeout(() => {
                req.destroy();
                reject(new Error('Request timed out after 3 minutes. The model might be too slow or the prompt too large.'));
            }, 180000);

            // Ollama API format - enable streaming for live output
            const data = JSON.stringify({
                model: this.config.model,
                prompt: prompt,
                stream: true,  // Enable streaming
                options: {
                    temperature: this.config.temperature,
                    num_predict: this.config.num_predict,
                    top_p: this.config.top_p,
                    top_k: this.config.top_k,
                    stop: ['\n\n\n\n', '###', '===='] // Stop at excessive newlines
                }
            });

            const options = {
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: '/api/generate',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data),
                },
            };

            const req = httpModule.request(options, (res: any) => {
                let fullResponse = '';
                let buffer = '';
                let resolved = false; // Flag to prevent double resolution

                // Minimal output - just show the response is streaming

                res.on('data', (chunk: any) => {
                    buffer += chunk.toString();

                    // Process each line (streaming responses come line by line as JSON)
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || ''; // Keep incomplete line in buffer

                    for (const line of lines) {
                        if (!line.trim()) continue;

                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.response) {
                                // Print the chunk immediately if streaming to console
                                if (streamToConsole) {
                                    process.stdout.write(parsed.response);
                                }
                                fullResponse += parsed.response;
                            }

                            // Check if done
                            if (parsed.done && !resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                if (streamToConsole) {
                                    console.log('\n');
                                }
                                resolve(fullResponse);
                            }
                        } catch (e) {
                            logger.error(null, e as any);
                        }
                    }
                });

                res.on('end', () => {
                    if (resolved) return; // Already resolved, don't do anything

                    clearTimeout(timeout);

                    // Process any remaining buffer
                    if (buffer.trim()) {
                        try {
                            const parsed = JSON.parse(buffer);
                            if (parsed.response) {
                                if (streamToConsole) {
                                    process.stdout.write(parsed.response);
                                }
                                fullResponse += parsed.response;
                            }
                        } catch (e) {
                            logger.error(null, e as any);
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
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Check if SSH tunnel is active
     */
    isUsingSSHTunnel(): boolean {
        return this.sshTunnel !== null && this.sshTunnel.isConnected();
    }
}

// Legacy function exports for backwards compatibility
export async function ensureOllamaRunning(model: string): Promise<boolean> {
    const service = new LLMService({
        endpoint: 'http://localhost:11434',
        model: model
    });
    await service.initialize();
    return true;
}

export async function callLLMAPI(prompt: string, endpoint: string, model: string): Promise<string> {
    const service = new LLMService({
        endpoint: endpoint,
        model: model
    });
    await service.initialize();
    const result = await service.generateCompletion(prompt);
    await service.cleanup();
    return result;
}
