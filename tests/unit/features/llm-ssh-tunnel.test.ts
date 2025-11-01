import { describe, it, expect, jest } from '@jest/globals';

// Mock chalk before importing SSHTunnel
jest.mock('chalk', () => ({
    default: {
        dim: (str: string) => str,
        green: (str: string) => str,
        red: (str: string) => str,
    },
}));

import { SSHTunnel } from '../../../migrator/features/llm/ssh-tunnel';
import { SSHConfig } from '../../../migrator/features/llm/types';

describe('SSH Tunnel', () => {
    describe('Constructor', () => {
        it('should create tunnel with configuration', () => {
            const config: SSHConfig = {
                host: 'testhost',
                port: 22,
                username: 'testuser',
                password: 'testpass',
                remotePort: 11434,
                localPort: 11434,
            };

            const tunnel = new SSHTunnel(config);

            expect(tunnel).toBeDefined();
        });

        it('should create tunnel with private key configuration', () => {
            const config: SSHConfig = {
                host: 'testhost',
                port: 22,
                username: 'testuser',
                privateKeyPath: '/path/to/key',
                remotePort: 11434,
                localPort: 11434,
            };

            const tunnel = new SSHTunnel(config);

            expect(tunnel).toBeDefined();
        });
    });

    describe('Connection State', () => {
        it('should report not connected initially', () => {
            const config: SSHConfig = {
                host: 'testhost',
                port: 22,
                username: 'testuser',
                password: 'testpass',
                remotePort: 11434,
                localPort: 11434,
            };

            const tunnel = new SSHTunnel(config);

            expect(tunnel.isConnected()).toBe(false);
        });

        it('should return local port', () => {
            const config: SSHConfig = {
                host: 'testhost',
                port: 22,
                username: 'testuser',
                password: 'testpass',
                remotePort: 11434,
                localPort: 12345,
            };

            const tunnel = new SSHTunnel(config);

            expect(tunnel.getLocalPort()).toBe(12345);
        });
    });

    describe('Disconnection', () => {
        it('should handle disconnect when not connected', () => {
            const config: SSHConfig = {
                host: 'testhost',
                port: 22,
                username: 'testuser',
                password: 'testpass',
                remotePort: 11434,
                localPort: 11434,
            };

            const tunnel = new SSHTunnel(config);

            expect(() => tunnel.disconnect()).not.toThrow();
        });
    });
});
