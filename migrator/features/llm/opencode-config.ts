import { OpencodeConfig } from './types';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Loads OpenCode configuration from environment variables
 */
export function loadOpencodeConfig(): OpencodeConfig {
    const model = process.env.LLM_MODEL || 'anthropic/claude-3-5-sonnet-20241022';

    const config: OpencodeConfig = {
        model,
        temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.2'),
        max_tokens: parseInt(process.env.LLM_MAX_TOKENS || '4000', 10),
        top_p: parseFloat(process.env.LLM_TOP_P || '0.85'),
        port: parseInt(process.env.OPENCODE_PORT || '4096', 10),
        hostname: process.env.OPENCODE_HOSTNAME || '127.0.0.1',
        useExternalServer:
            process.env.OPENCODE_USE_EXTERNAL === 'true' ||
            process.env.OPENCODE_USE_EXTERNAL === '1',
    };

    return config;
}

/**
 * Gets a summary of the OpenCode configuration
 */
export function getOpencodeConfigSummary(): string {
    const config = loadOpencodeConfig();
    const lines: string[] = [];

    lines.push('OpenCode LLM Configuration:');
    lines.push(`  Provider: OpenCode SDK`);
    lines.push(
        `  Server: ${config.useExternalServer ? 'External' : 'Embedded'} (${config.hostname}:${config.port})`
    );
    lines.push(`  Model: ${config.model}`);
    lines.push(`  Temperature: ${config.temperature}`);
    lines.push(`  Max Tokens: ${config.max_tokens}`);
    lines.push(`  Top P: ${config.top_p}`);

    return lines.join('\n');
}
