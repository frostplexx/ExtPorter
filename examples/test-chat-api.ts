#!/usr/bin/env ts-node

/**
 * Test script demonstrating the difference between completion and chat APIs
 */

import * as path from 'path';
import { buildChatMessagesFromFile } from '../migrator/features/llm';

console.log('=== Chat API Format Test ===\n');

const templatePath = path.join(
    __dirname,
    '..',
    'ext_analyzer',
    'prompts',
    'extension-description.txt'
);

const messages = buildChatMessagesFromFile(templatePath, {
    extension_name: 'Example Extension',
    manifest_summary:
        'Manifest.json: {"name": "Example", "version": "1.0", "permissions": ["tabs", "storage"]}',
    extension_files: `background.js:
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete') {
        console.log('Tab loaded:', tab.url);
    }
});

---

content.js:
document.body.style.border = "5px solid red";
console.log('Content script injected');`,
});

console.log('The code now sends these SEPARATE messages to /api/chat:\n');

console.log('MESSAGE 1 (System):');
console.log('─'.repeat(80));
console.log(messages[0].content);
console.log('─'.repeat(80));
console.log('');

console.log('MESSAGE 2 (User):');
console.log('─'.repeat(80));
console.log(messages[1].content);
console.log('─'.repeat(80));
console.log('');

console.log('BENEFIT: The model treats message 1 as INSTRUCTIONS to follow,');
console.log('         and message 2 as CONTENT to analyze.');
console.log('         This prevents the "trying to deceive users" issue!');
