#!/usr/bin/env ts-node
/**
 * Example script demonstrating LLM service usage with SSH tunneling
 *
 * The service will automatically use configuration from .env file
 * To enable SSH tunneling, set SSH_ENABLED=true in .env and configure SSH_* variables
 *
 * Usage:
 *   ts-node examples/llm-remote-example.ts
 *
 * Or to use custom config:
 *   ts-node examples/llm-remote-example.ts custom
 */

import { LLMService, getConfigSummary } from '../migrator/features/llm';

async function main() {
    const mode = process.argv[2] || 'env';

    let service: LLMService;

    if (mode === 'custom') {
        console.log('Using custom configuration...\n');

        // Example of manually configuring SSH
        service = new LLMService({
            endpoint: 'http://localhost:11434',
            model: 'llama2',
            ssh: {
                host: 'aranuka.plai.ifi.lmu.de',
                port: 54321,
                username: 'ra24mif',
                password: process.env.SSH_PASSWORD,
                remotePort: 11434,
                localPort: 11434
            }
        });
    } else {
        console.log('Using environment configuration...\n');
        console.log(getConfigSummary());
        console.log();

        // Load configuration from .env file
        service = LLMService.fromEnv();
    }

    try {
        // Initialize the service (establishes SSH tunnel if configured)
        await service.initialize();

        if (service.isUsingSSHTunnel()) {
            console.log('✓ SSH tunnel is active\n');
        }

        // Generate a completion
        const prompt = 'Explain what a browser extension is in 2-3 sentences.';
        console.log(`Prompt: ${prompt}\n`);

        const response = await service.generateCompletion(prompt);

        console.log('\n--- Final Response ---');
        console.log(response);

    } catch (error: any) {
        console.error('Error:', error.message);
        process.exit(1);
    } finally {
        // Always cleanup (closes SSH tunnel if active)
        await service.cleanup();
        console.log('\n✓ Cleanup complete');
    }
}

// Run the example
main().catch(console.error);
