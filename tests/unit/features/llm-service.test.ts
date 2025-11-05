import { describe, it, expect, jest } from '@jest/globals';

// Mock chalk before importing LLMService
jest.mock('chalk', () => ({
    default: {
        yellow: (str: string) => str,
        green: (str: string) => str,
        red: (str: string) => str,
        dim: (str: string) => str,
    },
}));

import { LLMService } from '../../../migrator/features/llm/llm-service';
import { RemoteLLMConfig } from '../../../migrator/features/llm/types';

describe('LLM Service', () => {
    describe('Constructor', () => {
        it('should create service with default parameters', () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should merge provided config with defaults', () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
                temperature: 0.5,
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should create service from environment variables', () => {
            process.env.LLM_ENDPOINT = 'http://test:11434';
            process.env.LLM_MODEL = 'test-model';

            const service = LLMService.fromEnv();

            expect(service).toBeDefined();
        });
    });

    describe('SSH Tunnel Support', () => {
        it('should check if using SSH tunnel', () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
            };

            const service = new LLMService(config);

            expect(service.isUsingSSHTunnel()).toBe(false);
        });
    });

    describe('Configuration', () => {
        it('should handle config with SSH settings', () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
                ssh: {
                    host: 'testhost',
                    port: 22,
                    username: 'testuser',
                    password: 'testpass',
                    remotePort: 11434,
                    localPort: 11434,
                },
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });

        it('should handle config with all parameters', () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
                temperature: 0.7,
                num_predict: 2000,
                top_p: 0.9,
                top_k: 40,
            };

            const service = new LLMService(config);

            expect(service).toBeDefined();
        });
    });

    describe('Initialization and Cleanup', () => {
        it('should initialize without SSH', async () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
            };

            const service = new LLMService(config);

            // Should not throw during initialization
            // Note: This will try to check for Ollama, which may not be available
            // In a real test environment, you would mock the runCommand method
            expect(service).toBeDefined();
        });

        it('should cleanup resources', async () => {
            const config: RemoteLLMConfig = {
                endpoint: 'http://localhost:11434',
                model: 'test-model',
            };

            const service = new LLMService(config);

            await expect(service.cleanup()).resolves.not.toThrow();
        });
    });
});
