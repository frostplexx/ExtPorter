import * as https from 'https';
import * as http from 'http';
import chalk from 'chalk';
import { runCommand } from './file-operations';

export async function ensureOllamaRunning(model: string): Promise<boolean> {
    try {
        // Check if Ollama is running by trying to list models
        const checkResult = await runCommand('ollama', ['list'], false);

        if (checkResult.success) {
            // Check if model is available
            if (checkResult.output.includes(model)) {
                return true;
            } else {
                // Model not found, try to pull it
                console.log(chalk.yellow(`⚠ Model '${model}' not found`));
                console.log(chalk.dim(`Downloading model '${model}'... (this may take a few minutes)`));

                const pullResult = await runCommand('ollama', ['pull', model], true);

                if (pullResult.success) {
                    console.log(chalk.green(`✓ Model '${model}' downloaded successfully`));
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
            await runCommand('ollama', ['serve'], false, true);

            // Wait a bit for Ollama to start
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Check again
            const recheckResult = await runCommand('ollama', ['list'], false);

            if (recheckResult.success) {
                console.log(chalk.green('✓ Ollama started successfully'));

                // Now check/download the model
                if (!recheckResult.output.includes(model)) {
                    console.log(chalk.dim(`Downloading model '${model}'... (this may take a few minutes)`));
                    const pullResult = await runCommand('ollama', ['pull', model], true);

                    if (!pullResult.success) {
                        console.log(chalk.red(`✗ Failed to download model: ${pullResult.error}`));
                        return false;
                    }
                    console.log(chalk.green(`✓ Model '${model}' downloaded successfully`));
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

export async function callLLMAPI(prompt: string, endpoint: string, model: string): Promise<string> {
    return new Promise((resolve, reject) => {
        // Parse endpoint URL
        const url = new URL(endpoint);
        const isHttps = url.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        // Set a timeout (3 minutes)
        const timeout = setTimeout(() => {
            req.destroy();
            reject(new Error('Request timed out after 3 minutes. The model might be too slow or the prompt too large.'));
        }, 180000);

        // Ollama API format - enable streaming for live output
        const data = JSON.stringify({
            model: model,
            prompt: prompt,
            stream: true,  // Enable streaming
            options: {
                temperature: 0.2,  // Very focused
                num_predict: 4000,   // Allow more detailed output with better context
                top_p: 0.85,
                top_k: 30,
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

            console.log(chalk.cyan('\n--- Generated Description ---\n'));

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
                            // Print the chunk immediately
                            process.stdout.write(parsed.response);
                            fullResponse += parsed.response;
                        }

                        // Check if done
                        if (parsed.done && !resolved) {
                            resolved = true;
                            clearTimeout(timeout);
                            console.log(chalk.cyan('\n\n--- End of Description ---\n'));
                            console.log(chalk.green('✓ Description generated successfully'));
                            resolve(fullResponse);
                        }
                    } catch (e) {
                        // Skip invalid JSON lines
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
                            process.stdout.write(parsed.response);
                            fullResponse += parsed.response;
                        }
                    } catch (e) {
                        // Ignore
                    }
                }

                if (fullResponse) {
                    console.log(chalk.cyan('\n\n--- End of Description ---\n'));
                    console.log(chalk.green('✓ Description generated successfully'));
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
