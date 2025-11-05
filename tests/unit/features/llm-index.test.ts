import { describe, it, expect, jest } from '@jest/globals';

// Mock chalk before importing
jest.mock('chalk', () => ({
    default: {
        yellow: (str: string) => str,
        green: (str: string) => str,
        red: (str: string) => str,
        dim: (str: string) => str,
    },
}));

import {
    LLMService,
    loadLLMConfig,
    loadSSHConfig,
    isSSHEnabled,
    buildPromptFromString,
    getTemplatePlaceholders,
} from '../../../migrator/features/llm/index';

describe('LLM Index Exports', () => {
    it('should export LLMService', () => {
        expect(LLMService).toBeDefined();
    });

    it('should export loadLLMConfig', () => {
        expect(loadLLMConfig).toBeDefined();
        expect(typeof loadLLMConfig).toBe('function');
    });

    it('should export loadSSHConfig', () => {
        expect(loadSSHConfig).toBeDefined();
        expect(typeof loadSSHConfig).toBe('function');
    });

    it('should export isSSHEnabled', () => {
        expect(isSSHEnabled).toBeDefined();
        expect(typeof isSSHEnabled).toBe('function');
    });

    it('should export buildPromptFromString', () => {
        expect(buildPromptFromString).toBeDefined();
        expect(typeof buildPromptFromString).toBe('function');
    });

    it('should export getTemplatePlaceholders', () => {
        expect(getTemplatePlaceholders).toBeDefined();
        expect(typeof getTemplatePlaceholders).toBe('function');
    });
});
