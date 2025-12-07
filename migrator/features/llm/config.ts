import { CopilotConfig } from './types';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Loads LLM configuration from environment variables for GitHub Copilot API
 *
 * Note: GitHub Copilot authentication is handled automatically via the copilot-auth module.
 * It will use cached OAuth tokens from VS Code/GitHub CLI or initiate a device flow if needed.
 * You do NOT need to set GITHUB_TOKEN or COPILOT_API_KEY manually for Copilot to work.
 */
export function loadLLMConfig(): CopilotConfig {
    const model = process.env.LLM_MODEL || 'gpt-4o';

    const config: CopilotConfig = {
        // API key is no longer needed - authentication is handled by copilot-auth.ts
        apiKey: '',
        model,
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
    lines.push(`  Endpoint: https://api.githubcopilot.com`);
    lines.push(`  Model: ${config.model}`);
    lines.push(`  Auth: Automatic (via cached OAuth token or device flow)`);
    lines.push(`  Temperature: ${config.temperature}`);
    lines.push(`  Max Tokens: ${config.max_tokens}`);
    lines.push(`  Top P: ${config.top_p}`);

    return lines.join('\n');
}
