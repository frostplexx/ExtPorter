import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import chalk from 'chalk';
import { SSHConfig } from './types';

export class SSHTunnel {
    private process: ChildProcess | null = null;
    private config: SSHConfig;
    private connected: boolean = false;

    constructor(config: SSHConfig) {
        this.config = config;
    }

    /**
     * Establishes an SSH tunnel using the ssh command
     * Format: ssh -p [port] -L [localPort]:localhost:[remotePort] [user]@[host]
     * Uses sshpass for password authentication or private key
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            let command = 'ssh';
            let args: string[] = [];

            // Use sshpass for password authentication if password is provided and no private key
            if (this.config.password && !this.config.privateKeyPath) {
                command = 'sshpass';
                args = ['-p', this.config.password, 'ssh'];
            }

            // Common SSH arguments
            args.push(
                '-o',
                'StrictHostKeyChecking=no',
                '-o',
                'UserKnownHostsFile=/dev/null',
                '-o',
                'LogLevel=ERROR',
                '-o',
                'PreferredAuthentications=password',
                '-o',
                'PubkeyAuthentication=no',
                '-o',
                'NumberOfPasswordPrompts=1',
                '-p',
                this.config.port.toString(),
                '-L',
                `${this.config.localPort}:localhost:${this.config.remotePort}`,
                '-N' // Don't execute remote command
            );

            // Add private key if provided
            if (this.config.privateKeyPath && fs.existsSync(this.config.privateKeyPath)) {
                args.push('-i', this.config.privateKeyPath);
            }

            args.push(`${this.config.username}@${this.config.host}`);

            console.log(chalk.dim(`Establishing SSH tunnel to ${this.config.host}...`));

            this.process = spawn(command, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
            });

            let errorOutput = '';
            let establishmentTimeout: NodeJS.Timeout = setTimeout(() => {}, 0);

            // Capture any error output
            this.process.stderr?.on('data', (data) => {
                const output = data.toString();
                errorOutput += output;
            });

            this.process.on('error', (error) => {
                clearTimeout(establishmentTimeout);
                this.connected = false;
                if (error.message.includes('ENOENT') && command === 'sshpass') {
                    reject(
                        new Error(
                            'sshpass not found. Install it with: brew install hudochenkov/sshpass/sshpass (macOS) or apt-get install sshpass (Linux)'
                        )
                    );
                } else {
                    reject(new Error(`Failed to start SSH process: ${error.message}`));
                }
            });

            this.process.on('close', (code) => {
                this.connected = false;
                if (code !== 0 && !this.connected) {
                    clearTimeout(establishmentTimeout);
                    const errorMsg = errorOutput.trim() || `SSH tunnel failed (exit code ${code})`;
                    reject(new Error(errorMsg));
                }
            });

            // Give it some time to establish connection
            establishmentTimeout = setTimeout(() => {
                if (this.connected) return;

                // Check if we have any error indicators
                if (
                    errorOutput.includes('Permission denied') ||
                    errorOutput.includes('Connection refused') ||
                    errorOutput.includes('Could not resolve hostname')
                ) {
                    this.disconnect();
                    reject(new Error(`SSH connection failed: ${errorOutput}`));
                } else {
                    // Assume success if no errors after timeout
                    this.connected = true;
                    console.log(chalk.green('✓ SSH tunnel established'));
                    resolve();
                }
            }, 3000); // 3 second timeout
        });
    }

    /**
     * Disconnects the SSH tunnel
     */
    disconnect(): void {
        if (this.process && !this.process.killed) {
            this.process.kill();
            this.process = null;
            this.connected = false;
        }
    }

    /**
     * Checks if the tunnel is currently connected
     */
    isConnected(): boolean {
        return this.connected && this.process !== null && !this.process.killed;
    }

    /**
     * Gets the local port that the tunnel is forwarding to
     */
    getLocalPort(): number {
        return this.config.localPort;
    }
}
