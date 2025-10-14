import { RemoteLLMConfig, SSHConfig } from './types';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
dotenv.config();

/**
 * Parses an SSH URL of the format: ssh://user@host:sshport/ollamaport
 * Example: ssh://ra24mif@aranuka.plai.ifi.lmu.de:54321/11434
 * Or with password: ssh://user:password@host:sshport/ollamaport
 */
function parseSSHUrl(url: string): SSHConfig | null {
    try {
        // Match ssh://[user[:password]@]host[:port][/remotePath]
        const sshUrlPattern = /^ssh:\/\/(?:([^:@]+)(?::([^@]+))?@)?([^:/]+)(?::(\d+))?(?:\/(\d+))?$/;
        const match = url.match(sshUrlPattern);

        if (!match) {
            return null;
        }

        const [, username, password, host, sshPort, remotePort] = match;

        if (!username || !host) {
            console.warn('Warning: SSH URL must include username and host (ssh://user@host:port/remotePort)');
            return null;
        }

        // Check for password or private key
        const privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH;
        const envPassword = process.env.SSH_PASSWORD;

        if (!password && !privateKeyPath && !envPassword) {
            console.warn('Warning: SSH requires password in URL, SSH_PASSWORD, or SSH_PRIVATE_KEY_PATH environment variable');
            return null;
        }

        // Validate private key path if provided
        if (privateKeyPath && !fs.existsSync(privateKeyPath)) {
            console.warn(`Warning: SSH private key not found at ${privateKeyPath}`);
            return null;
        }

        const localPort = parseInt(process.env.SSH_LOCAL_PORT || '11434', 10);

        return {
            host,
            port: parseInt(sshPort || '22', 10),
            username,
            password: password || process.env.SSH_PASSWORD,
            privateKeyPath,
            remotePort: parseInt(remotePort || '11434', 10),
            localPort
        };
    } catch (error) {
        console.warn('Warning: Failed to parse SSH URL:', error);
        return null;
    }
}

/**
 * Loads LLM configuration from environment variables
 * Supports both standard URLs and SSH URLs (ssh://user@host:port/remotePort)
 */
export function loadLLMConfig(): RemoteLLMConfig {
    const endpoint = process.env.LLM_ENDPOINT || 'http://localhost:11434';
    const model = process.env.LLM_MODEL || 'codellama:latest';

    const config: RemoteLLMConfig = {
        endpoint,
        model
    };

    // Check if endpoint is an SSH URL
    if (endpoint.startsWith('ssh://')) {
        const sshConfig = parseSSHUrl(endpoint);
        if (sshConfig) {
            config.ssh = sshConfig;
            // Update endpoint to use local tunnel
            config.endpoint = `http://localhost:${sshConfig.localPort}`;
        }
    }
    // Legacy: Check if SSH is explicitly enabled via SSH_ENABLED
    else if (process.env.SSH_ENABLED === 'true') {
        const sshConfig = loadSSHConfig();
        if (sshConfig) {
            config.ssh = sshConfig;
        }
    }

    return config;
}

/**
 * Loads SSH configuration from environment variables
 */
export function loadSSHConfig(): SSHConfig | null {
    const host = process.env.SSH_HOST;
    const port = process.env.SSH_PORT;
    const username = process.env.SSH_USERNAME;

    // Require at minimum host, port, and username
    if (!host || !port || !username) {
        return null;
    }

    const password = process.env.SSH_PASSWORD;
    const privateKeyPath = process.env.SSH_PRIVATE_KEY_PATH;

    // Require either password or private key
    if (!password && !privateKeyPath) {
        console.warn('Warning: SSH configuration requires either SSH_PASSWORD or SSH_PRIVATE_KEY_PATH');
        return null;
    }

    // Validate private key path exists if provided
    if (privateKeyPath && !fs.existsSync(privateKeyPath)) {
        console.warn(`Warning: SSH private key not found at ${privateKeyPath}`);
        return null;
    }

    const remotePort = parseInt(process.env.SSH_REMOTE_PORT || '11434', 10);
    const localPort = parseInt(process.env.SSH_LOCAL_PORT || '11434', 10);

    return {
        host,
        port: parseInt(port, 10),
        username,
        password,
        privateKeyPath,
        remotePort,
        localPort
    };
}

/**
 * Checks if SSH tunneling is configured and enabled
 */
export function isSSHEnabled(): boolean {
    return process.env.SSH_ENABLED === 'true' && loadSSHConfig() !== null;
}

/**
 * Gets a summary of the current configuration
 */
export function getConfigSummary(): string {
    const config = loadLLMConfig();
    const lines: string[] = [];

    lines.push('LLM Configuration:');
    lines.push(`  Endpoint: ${config.endpoint}`);
    lines.push(`  Model: ${config.model}`);

    if (config.ssh) {
        lines.push('  SSH Tunnel: Enabled');
        lines.push(`    Host: ${config.ssh.host}:${config.ssh.port}`);
        lines.push(`    Username: ${config.ssh.username}`);
        lines.push(`    Auth: ${config.ssh.privateKeyPath ? 'Private Key' : 'Password'}`);
        lines.push(`    Tunnel: localhost:${config.ssh.localPort} -> remote localhost:${config.ssh.remotePort}`);
    } else {
        lines.push('  SSH Tunnel: Disabled');
    }

    return lines.join('\n');
}
