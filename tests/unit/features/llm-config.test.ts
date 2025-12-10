import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { loadLLMConfig, getConfigSummary } from '../../../migrator/features/llm/config';

describe('LLM Config', () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('loadLLMConfig', () => {
        it('should load default configuration', () => {
            delete process.env.LLM_MODEL;

            const config = loadLLMConfig();

            expect(config.model).toBe('gpt-4o');
            // apiKey is now always empty (auth handled by copilot-auth)
            expect(config.apiKey).toBe('');
        });

        it('should load model from environment', () => {
            process.env.LLM_MODEL = 'gpt-4';

            const config = loadLLMConfig();

            expect(config.model).toBe('gpt-4');
        });

        it('should load temperature from environment', () => {
            process.env.LLM_TEMPERATURE = '0.5';

            const config = loadLLMConfig();

            expect(config.temperature).toBe(0.5);
        });

        it('should load max_tokens from environment', () => {
            process.env.LLM_MAX_TOKENS = '8000';

            const config = loadLLMConfig();

            expect(config.max_tokens).toBe(8000);
        });

        it('should load top_p from environment', () => {
            process.env.LLM_TOP_P = '0.9';

            const config = loadLLMConfig();

            expect(config.top_p).toBe(0.9);
        });

        it('should use default values for optional parameters', () => {
            delete process.env.LLM_TEMPERATURE;
            delete process.env.LLM_MAX_TOKENS;
            delete process.env.LLM_TOP_P;

            const config = loadLLMConfig();

            expect(config.temperature).toBe(0.2);
            expect(config.max_tokens).toBe(4000);
            expect(config.top_p).toBe(0.85);
        });
    });

    describe('getConfigSummary', () => {
        it('should return summary with GitHub Copilot provider', () => {
            process.env.LLM_MODEL = 'gpt-4o';

            const summary = getConfigSummary();

            expect(summary).toContain('LLM Configuration:');
            expect(summary).toContain('Provider: GitHub Copilot');
            expect(summary).toContain('Endpoint: https://api.githubcopilot.com');
            expect(summary).toContain('Model: gpt-4o');
        });

        it('should show automatic auth in summary', () => {
            const summary = getConfigSummary();

            expect(summary).toContain('Auth: Automatic');
        });

        it('should show temperature, max_tokens, and top_p in summary', () => {
            process.env.LLM_TEMPERATURE = '0.3';
            process.env.LLM_MAX_TOKENS = '5000';
            process.env.LLM_TOP_P = '0.9';

            const summary = getConfigSummary();

            expect(summary).toContain('Temperature: 0.3');
            expect(summary).toContain('Max Tokens: 5000');
            expect(summary).toContain('Top P: 0.9');
        });
    });
});
