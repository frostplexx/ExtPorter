import { describe, it, expect } from '@jest/globals';
import { LLMService } from '../../../migrator/features/llm/llm-service';
import { CopilotConfig } from '../../../migrator/features/llm/types';

describe('LLM Service', () => {
    describe('Constructor', () => {
        it('should create service with minimal config', () => {
            const config: CopilotConfig = {
                apiKey: 'test-key',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should merge provided config with defaults', () => {
            const config: CopilotConfig = {
                apiKey: 'test-key',
                model: 'gpt-4',
                temperature: 0.5,
                max_tokens: 8000,
                top_p: 0.9,
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should create service from environment variables', () => {
            process.env.GITHUB_TOKEN = 'test-token';
            process.env.LLM_MODEL = 'gpt-4o';

            const service = LLMService.fromEnv();

            expect(service).toBeDefined();
        });
    });

    describe('Configuration', () => {
        it('should return the configured model', () => {
            const config: CopilotConfig = {
                apiKey: 'test-key',
                model: 'gpt-4',
            };

            const service = new LLMService(config);

            expect(service.getModel()).toBe('gpt-4');
        });

        it('should check if service is configured', () => {
            const configuredService = new LLMService({
                apiKey: 'test-key',
                model: 'gpt-4o',
            });

            const unconfiguredService = new LLMService({
                apiKey: '',
                model: 'gpt-4o',
            });

            expect(configuredService.isConfigured()).toBe(true);
            expect(unconfiguredService.isConfigured()).toBe(false);
        });
    });

    describe('Initialization and Cleanup', () => {
        it('should initialize without errors when properly configured', async () => {
            const config: CopilotConfig = {
                apiKey: 'test-key',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            await expect(service.initialize()).resolves.toBeUndefined();
        });

        it('should throw error when API key is missing during initialization', async () => {
            const config: CopilotConfig = {
                apiKey: '',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            await expect(service.initialize()).rejects.toThrow('GitHub API token not configured');
        });

        it('should cleanup without errors', async () => {
            const config: CopilotConfig = {
                apiKey: 'test-key',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            await expect(service.cleanup()).resolves.toBeUndefined();
        });
    });
});
