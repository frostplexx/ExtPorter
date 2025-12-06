import { CopilotConfig } from './types';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Loads LLM configuration from environment variables for GitHub Copilot API
 */
export function loadLLMConfig(): CopilotConfig {
    const apiKey = process.env.GITHUB_TOKEN || process.env.COPILOT_API_KEY || '';
    const model = process.env.LLM_MODEL || 'gpt-4o';
    const endpoint = process.env.COPILOT_ENDPOINT || 'https://api.githubcopilot.com';

    if (!apiKey) {
        console.warn(
            'Warning: GitHub token not found. Set GITHUB_TOKEN or COPILOT_API_KEY environment variable.'
        );
    }

    const config: CopilotConfig = {
        apiKey,
        model,
        endpoint,
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.2'),
        max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '4000', 10),
        top_p: parseFloat(process.env.LLM_TOP_P || '0.85'),
    };

    return config;
}

/**
 * Gets a summary of the current configuration
 */
export function getConfigSummary(): string {
    const config = loadLLMConfig();
    const lines: string[] = [];

    lines.push('LLM Configuration:');
    lines.push(`  Provider: GitHub Copilot`);
    lines.push(`  Endpoint: ${config.endpoint}`);
    lines.push(`  Model: ${config.model}`);
    lines.push(`  API Key: ${config.apiKey ? '***' + config.apiKey.slice(-4) : 'NOT SET'}`);
    lines.push(`  Temperature: ${config.temperature}`);
    lines.push(`  Max Tokens: ${config.max_tokens}`);
    lines.push(`  Top P: ${config.top_p}`);

    return lines.join('\n');
}
