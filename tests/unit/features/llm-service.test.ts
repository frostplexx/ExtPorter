import { describe, it, expect, jest } from '@jest/globals';
import { LLMService } from '../../../migrator/features/llm/llm-service';
import { CopilotConfig } from '../../../migrator/features/llm/types';

// Mock the copilot-auth module
jest.mock('../../../migrator/features/llm/copilot-auth', () => ({
    getCopilotHeaders: jest.fn<() => Promise<Record<string, string>>>().mockResolvedValue({
        Authorization: 'Bearer mock-token',
        'Content-Type': 'application/json',
        'Editor-Version': 'ExtPorter/1.0.0',
        'Editor-Plugin-Version': 'ExtPorter-LLM-Client/1.0',
        'Copilot-Integration-Id': 'vscode-chat',
        'User-Agent': 'ExtPorter-LLM-Client/1.0',
    }),
    clearTokenCache: jest.fn(),
}));

describe('LLM Service', () => {
    describe('Constructor', () => {
        it('should create service with minimal config', () => {
            const config: CopilotConfig = {
                apiKey: '',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should merge provided config with defaults', () => {
            const config: CopilotConfig = {
                apiKey: '',
                model: 'gpt-4',
                temperature: 0.5,
                max_tokens: 8000,
                top_p: 0.9,
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should create service from environment variables', () => {
            process.env.LLM_MODEL = 'gpt-4o';

            const service = LLMService.fromEnv();

            expect(service).toBeDefined();
        });
    });

    describe('Configuration', () => {
        it('should return the configured model', () => {
            const config: CopilotConfig = {
                apiKey: '',
                model: 'gpt-4',
            };

            const service = new LLMService(config);

            expect(service.getModel()).toBe('gpt-4');
        });

        it('should always report as configured (auth handled separately)', () => {
            const service = new LLMService({
                apiKey: '',
                model: 'gpt-4o',
            });

            // isConfigured always returns true since auth is handled by copilot-auth
            expect(service.isConfigured()).toBe(true);
        });
    });

    describe('Initialization and Cleanup', () => {
        it('should initialize and get Copilot headers', async () => {
            const config: CopilotConfig = {
                apiKey: '',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            await expect(service.initialize()).resolves.toBeUndefined();
        });

        it('should cleanup without errors', async () => {
            const config: CopilotConfig = {
                apiKey: '',
                model: 'gpt-4o',
            };

            const service = new LLMService(config);

            await expect(service.cleanup()).resolves.toBeUndefined();
        });
    });
});
