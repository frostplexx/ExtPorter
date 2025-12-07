import { describe, it, expect } from '@jest/globals';
import {
    LLMService,
    loadLLMConfig,
    getConfigSummary,
    llmManager,
} from '../../../migrator/features/llm';

describe('LLM Module Exports', () => {
    it('should export LLMService', () => {
        expect(LLMService).toBeDefined();
        expect(typeof LLMService).toBe('function');
    });

    it('should export loadLLMConfig', () => {
        expect(loadLLMConfig).toBeDefined();
        expect(typeof loadLLMConfig).toBe('function');
    });

    it('should export getConfigSummary', () => {
        expect(getConfigSummary).toBeDefined();
        expect(typeof getConfigSummary).toBe('function');
    });

    it('should export llmManager', () => {
        expect(llmManager).toBeDefined();
        expect(typeof llmManager).toBe('object');
    });

    it('should be able to create LLMService instance', () => {
        const service = new LLMService({
            apiKey: 'test-key',
            model: 'gpt-4o',
        });

        expect(service).toBeInstanceOf(LLMService);
    });
});
