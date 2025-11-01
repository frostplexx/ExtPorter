import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
    loadLLMConfig,
    loadSSHConfig,
    isSSHEnabled,
    getConfigSummary,
} from '../../../migrator/features/llm/config';

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
            delete process.env.LLM_ENDPOINT;
            delete process.env.LLM_MODEL;

            const config = loadLLMConfig();

            expect(config.endpoint).toBe('http://localhost:11434');
            expect(config.model).toBe('codellama:latest');
        });

        it('should load configuration from environment variables', () => {
            process.env.LLM_ENDPOINT = 'http://test-server:8080';
            process.env.LLM_MODEL = 'test-model:1.0';

            const config = loadLLMConfig();

            expect(config.endpoint).toBe('http://test-server:8080');
            expect(config.model).toBe('test-model:1.0');
        });

        it('should parse SSH URL and configure SSH tunnel', () => {
            process.env.LLM_ENDPOINT = 'ssh://testuser@testhost:2222/11434';
            process.env.SSH_PASSWORD = 'testpass';

            const config = loadLLMConfig();

            expect(config.ssh).toBeDefined();
            expect(config.ssh?.host).toBe('testhost');
            expect(config.ssh?.port).toBe(2222);
            expect(config.ssh?.username).toBe('testuser');
            expect(config.ssh?.password).toBe('testpass');
            expect(config.ssh?.remotePort).toBe(11434);
            expect(config.endpoint).toBe('http://localhost:11434');
        });

        it('should parse SSH URL with password in URL', () => {
            process.env.LLM_ENDPOINT = 'ssh://user:pass@host:22/11434';

            const config = loadLLMConfig();

            expect(config.ssh).toBeDefined();
            expect(config.ssh?.username).toBe('user');
            expect(config.ssh?.password).toBe('pass');
        });

        it('should handle SSH URL without port', () => {
            process.env.LLM_ENDPOINT = 'ssh://user@host/11434';
            process.env.SSH_PASSWORD = 'pass';

            const config = loadLLMConfig();

            expect(config.ssh).toBeDefined();
            expect(config.ssh?.port).toBe(22); // Default SSH port
        });

        it('should handle SSH URL without remote port', () => {
            process.env.LLM_ENDPOINT = 'ssh://user@host:22';
            process.env.SSH_PASSWORD = 'pass';

            const config = loadLLMConfig();

            expect(config.ssh).toBeDefined();
            expect(config.ssh?.remotePort).toBe(11434); // Default Ollama port
        });

        it('should use SSH_ENABLED legacy mode', () => {
            process.env.LLM_ENDPOINT = 'http://localhost:11434';
            process.env.SSH_ENABLED = 'true';
            process.env.SSH_HOST = 'testhost';
            process.env.SSH_PORT = '2222';
            process.env.SSH_USERNAME = 'testuser';
            process.env.SSH_PASSWORD = 'testpass';

            const config = loadLLMConfig();

            expect(config.ssh).toBeDefined();
            expect(config.ssh?.host).toBe('testhost');
        });

        it('should handle invalid SSH URL gracefully', () => {
            process.env.LLM_ENDPOINT = 'ssh://invalid-url';

            const config = loadLLMConfig();

            expect(config.ssh).toBeUndefined();
        });

        it('should handle SSH URL without username', () => {
            process.env.LLM_ENDPOINT = 'ssh://testhost:22/11434';

            const config = loadLLMConfig();

            expect(config.ssh).toBeUndefined();
        });

        it('should handle SSH URL without authentication', () => {
            process.env.LLM_ENDPOINT = 'ssh://user@host:22/11434';
            delete process.env.SSH_PASSWORD;
            delete process.env.SSH_PRIVATE_KEY_PATH;

            const config = loadLLMConfig();

            expect(config.ssh).toBeUndefined();
        });
    });

    describe('loadSSHConfig', () => {
        it('should return null when required fields are missing', () => {
            delete process.env.SSH_HOST;
            delete process.env.SSH_PORT;
            delete process.env.SSH_USERNAME;

            const config = loadSSHConfig();

            expect(config).toBeNull();
        });

        it('should load SSH configuration from environment', () => {
            process.env.SSH_HOST = 'testhost';
            process.env.SSH_PORT = '2222';
            process.env.SSH_USERNAME = 'testuser';
            process.env.SSH_PASSWORD = 'testpass';

            const config = loadSSHConfig();

            expect(config).not.toBeNull();
            expect(config?.host).toBe('testhost');
            expect(config?.port).toBe(2222);
            expect(config?.username).toBe('testuser');
            expect(config?.password).toBe('testpass');
        });

        it('should use default ports when not specified', () => {
            process.env.SSH_HOST = 'testhost';
            process.env.SSH_PORT = '22';
            process.env.SSH_USERNAME = 'testuser';
            process.env.SSH_PASSWORD = 'testpass';
            delete process.env.SSH_REMOTE_PORT;
            delete process.env.SSH_LOCAL_PORT;

            const config = loadSSHConfig();

            expect(config?.remotePort).toBe(11434);
            expect(config?.localPort).toBe(11434);
        });

        it('should return null when neither password nor private key is provided', () => {
            process.env.SSH_HOST = 'testhost';
            process.env.SSH_PORT = '22';
            process.env.SSH_USERNAME = 'testuser';
            delete process.env.SSH_PASSWORD;
            delete process.env.SSH_PRIVATE_KEY_PATH;

            const config = loadSSHConfig();

            expect(config).toBeNull();
        });

        it('should handle private key path', () => {
            // Create a temporary private key file
            const tempKeyPath = path.join('/tmp', `test-key-${Date.now()}`);
            fs.writeFileSync(tempKeyPath, 'fake-key-content', 'utf8');

            try {
                process.env.SSH_HOST = 'testhost';
                process.env.SSH_PORT = '22';
                process.env.SSH_USERNAME = 'testuser';
                process.env.SSH_PRIVATE_KEY_PATH = tempKeyPath;
                delete process.env.SSH_PASSWORD;

                const config = loadSSHConfig();

                expect(config).not.toBeNull();
                expect(config?.privateKeyPath).toBe(tempKeyPath);
            } finally {
                // Clean up
                if (fs.existsSync(tempKeyPath)) {
                    fs.unlinkSync(tempKeyPath);
                }
            }
        });

        it('should return null when private key file does not exist', () => {
            process.env.SSH_HOST = 'testhost';
            process.env.SSH_PORT = '22';
            process.env.SSH_USERNAME = 'testuser';
            process.env.SSH_PRIVATE_KEY_PATH = '/nonexistent/key/path';
            delete process.env.SSH_PASSWORD;

            const config = loadSSHConfig();

            expect(config).toBeNull();
        });
    });

    describe('isSSHEnabled', () => {
        it('should return false when SSH_ENABLED is not set', () => {
            delete process.env.SSH_ENABLED;

            const enabled = isSSHEnabled();

            expect(enabled).toBe(false);
        });

        it('should return false when SSH_ENABLED is false', () => {
            process.env.SSH_ENABLED = 'false';

            const enabled = isSSHEnabled();

            expect(enabled).toBe(false);
        });

        it('should return false when SSH config is invalid', () => {
            process.env.SSH_ENABLED = 'true';
            delete process.env.SSH_HOST;

            const enabled = isSSHEnabled();

            expect(enabled).toBe(false);
        });

        it('should return true when SSH is properly configured', () => {
            process.env.SSH_ENABLED = 'true';
            process.env.SSH_HOST = 'testhost';
            process.env.SSH_PORT = '22';
            process.env.SSH_USERNAME = 'testuser';
            process.env.SSH_PASSWORD = 'testpass';

            const enabled = isSSHEnabled();

            expect(enabled).toBe(true);
        });
    });

    describe('getConfigSummary', () => {
        it('should return summary without SSH', () => {
            process.env.LLM_ENDPOINT = 'http://localhost:11434';
            process.env.LLM_MODEL = 'test-model';
            delete process.env.SSH_ENABLED;

            const summary = getConfigSummary();

            expect(summary).toContain('LLM Configuration:');
            expect(summary).toContain('Endpoint: http://localhost:11434');
            expect(summary).toContain('Model: test-model');
            expect(summary).toContain('SSH Tunnel: Disabled');
        });

        it('should return summary with SSH enabled', () => {
            process.env.LLM_ENDPOINT = 'ssh://user@testhost:2222/11434';
            process.env.SSH_PASSWORD = 'pass';

            const summary = getConfigSummary();

            expect(summary).toContain('LLM Configuration:');
            expect(summary).toContain('SSH Tunnel: Enabled');
            expect(summary).toContain('Host: testhost:2222');
            expect(summary).toContain('Username: user');
            expect(summary).toContain('Auth: Password');
        });

        it('should show private key authentication in summary', () => {
            // Create a temporary private key file
            const tempKeyPath = path.join('/tmp', `test-key-${Date.now()}`);
            fs.writeFileSync(tempKeyPath, 'fake-key-content', 'utf8');

            try {
                process.env.LLM_ENDPOINT = 'ssh://user@testhost:2222/11434';
                process.env.SSH_PRIVATE_KEY_PATH = tempKeyPath;
                delete process.env.SSH_PASSWORD;

                const summary = getConfigSummary();

                expect(summary).toContain('Auth: Private Key');
            } finally {
                // Clean up
                if (fs.existsSync(tempKeyPath)) {
                    fs.unlinkSync(tempKeyPath);
                }
            }
        });
    });
});
