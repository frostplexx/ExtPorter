#!/usr/bin/env ts-node
/**
 * Test script to verify LLM configuration loading from .env
 */

import { loadLLMConfig, getConfigSummary, isSSHEnabled } from '../migrator/features/llm';

console.log('=== LLM Configuration Test ===\n');

console.log(getConfigSummary());
console.log();

const config = loadLLMConfig();

console.log('Configuration Object:');
console.log(JSON.stringify(config, null, 2));
console.log();

console.log('SSH Enabled:', isSSHEnabled());
console.log();

if (config.ssh) {
    console.log('✓ SSH Configuration Found');
    console.log('  - Will tunnel:', `${config.ssh.host}:${config.ssh.port}`);
    console.log(
        '  - Port forwarding:',
        `localhost:${config.ssh.localPort} -> remote localhost:${config.ssh.remotePort}`
    );
} else {
    console.log('ℹ No SSH Configuration (using direct connection)');
}
