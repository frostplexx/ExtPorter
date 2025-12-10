import { LLMService } from './llm-service';

/**
 * Global LLM service instance that persists across multiple calls
 * Maintains a single connection to the GitHub Copilot API
 */
class LLMManager {
    private static instance: LLMManager | null = null;
    private service: LLMService | null = null;
    private initialized: boolean = false;

    private constructor() {}

    static getInstance(): LLMManager {
        if (!LLMManager.instance) {
            LLMManager.instance = new LLMManager();
        }
        return LLMManager.instance;
    }

    async getService(): Promise<LLMService> {
        if (!this.service) {
            this.service = LLMService.fromEnv();
            await this.service.initialize();
            this.initialized = true;
        } else if (!this.initialized) {
            await this.service.initialize();
            this.initialized = true;
        }

        return this.service;
    }

    async cleanup(): Promise<void> {
        if (this.service && this.initialized) {
            await this.service.cleanup();
            this.service = null;
            this.initialized = false;
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }
}

export const llmManager = LLMManager.getInstance();
