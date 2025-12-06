import { OpencodeService } from './opencode-service';

/**
 * Global OpenCode service instance that persists across multiple calls
 * Maintains a single connection to OpenCode
 */
class OpencodeManager {
    private static instance: OpencodeManager | null = null;
    private service: OpencodeService | null = null;
    private initialized: boolean = false;

    private constructor() {}

    static getInstance(): OpencodeManager {
        if (!OpencodeManager.instance) {
            OpencodeManager.instance = new OpencodeManager();
        }
        return OpencodeManager.instance;
    }

    async getService(): Promise<OpencodeService> {
        if (!this.service) {
            this.service = OpencodeService.fromEnv();
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

export const opencodeManager = OpencodeManager.getInstance();
