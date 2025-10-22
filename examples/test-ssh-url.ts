#!/usr/bin/env ts-node
/**
 * Test script to verify SSH URL parsing
 */

import { loadLLMConfig } from '../migrator/features/llm';

console.log('=== SSH URL Parsing Test ===\n');

// Test various SSH URL formats
const testUrls = [
    'ssh://user@example.com/11434',
    'ssh://user@example.com:54321/11434',
    'ssh://user@example.com:54321',
    'ssh://user:password@example.com:54321/11434',
    'ssh://ra24mif@aranuka.plai.ifi.lmu.de:54321/11434',
    'http://localhost:11434',
    'http://remote.com:11434',
];

console.log('Testing URL formats:\n');

// Set SSH_PASSWORD for tests that need it
process.env.SSH_PASSWORD = 'test-password';

for (const url of testUrls) {
    console.log(`URL: ${url}`);

    // Temporarily set env var
    process.env.LLM_ENDPOINT = url;

    const config = loadLLMConfig();

    if (config.ssh) {
        console.log('  ✓ SSH detected');
        console.log(`    Host: ${config.ssh.host}:${config.ssh.port}`);
        console.log(`    User: ${config.ssh.username}`);
        console.log(`    Remote Port: ${config.ssh.remotePort}`);
        console.log(`    Local Port: ${config.ssh.localPort}`);
        console.log(`    Effective Endpoint: ${config.endpoint}`);
    } else {
        console.log('  ℹ Direct connection (no SSH)');
        console.log(`    Endpoint: ${config.endpoint}`);
    }
    console.log();
}

// Test with actual .env configuration
console.log('=== Current .env Configuration ===\n');
delete process.env.LLM_ENDPOINT; // Reset to use .env value
delete process.env.SSH_PASSWORD;

// Reload dotenv
require('dotenv').config();

const config = loadLLMConfig();
console.log('Endpoint from .env:', process.env.LLM_ENDPOINT);
console.log('Model:', config.model);
console.log('SSH Enabled:', config.ssh ? 'Yes' : 'No');

if (config.ssh) {
    console.log('\nSSH Configuration:');
    console.log(`  Host: ${config.ssh.host}:${config.ssh.port}`);
    console.log(`  Username: ${config.ssh.username}`);
    console.log(`  Remote Port: ${config.ssh.remotePort}`);
    console.log(`  Local Port: ${config.ssh.localPort}`);
    console.log(`  Effective Endpoint: ${config.endpoint}`);
}
