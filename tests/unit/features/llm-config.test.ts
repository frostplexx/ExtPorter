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
            delete process.env.GITHUB_TOKEN;
            delete process.env.COPILOT_API_KEY;
            delete process.env.LLM_MODEL;
            delete process.env.COPILOT_ENDPOINT;

            const config = loadLLMConfig();

            expect(config.endpoint).toBe('https://api.githubcopilot.com');
            expect(config.model).toBe('gpt-4o');
            expect(config.apiKey).toBe('');
        });

        it('should load configuration from GITHUB_TOKEN', () => {
            process.env.GITHUB_TOKEN = 'ghp_test_token';
            process.env.LLM_MODEL = 'gpt-4';
            process.env.COPILOT_ENDPOINT = 'https://api.example.com';

            const config = loadLLMConfig();

            expect(config.apiKey).toBe('ghp_test_token');
            expect(config.model).toBe('gpt-4');
            expect(config.endpoint).toBe('https://api.example.com');
        });

        it('should load configuration from COPILOT_API_KEY', () => {
            process.env.COPILOT_API_KEY = 'copilot_test_key';
            delete process.env.GITHUB_TOKEN;

            const config = loadLLMConfig();

            expect(config.apiKey).toBe('copilot_test_key');
        });

        it('should prefer GITHUB_TOKEN over COPILOT_API_KEY', () => {
            process.env.GITHUB_TOKEN = 'github_token';
            process.env.COPILOT_API_KEY = 'copilot_key';

            const config = loadLLMConfig();

            expect(config.apiKey).toBe('github_token');
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
            process.env.GITHUB_TOKEN = 'ghp_1234567890abcdef';
            process.env.LLM_MODEL = 'gpt-4o';
            process.env.COPILOT_ENDPOINT = 'https://api.githubcopilot.com';

            const summary = getConfigSummary();

            expect(summary).toContain('LLM Configuration:');
            expect(summary).toContain('Provider: GitHub Copilot');
            expect(summary).toContain('Endpoint: https://api.githubcopilot.com');
            expect(summary).toContain('Model: gpt-4o');
            expect(summary).toContain('API Key: ***cdef');
        });

        it('should mask API key in summary', () => {
            process.env.GITHUB_TOKEN = 'ghp_secret_token';

            const summary = getConfigSummary();

            expect(summary).toContain('***oken');
            expect(summary).not.toContain('ghp_secret_token');
        });

        it('should show NOT SET when API key is missing', () => {
            delete process.env.GITHUB_TOKEN;
            delete process.env.COPILOT_API_KEY;

            const summary = getConfigSummary();

            expect(summary).toContain('API Key: NOT SET');
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
