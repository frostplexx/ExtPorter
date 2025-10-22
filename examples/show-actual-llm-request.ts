#!/usr/bin/env ts-node

/**
 * This script shows exactly what gets sent to the LLM API
 * to help debug why the LLM might not be following instructions
 */

import * as path from 'path';
import { buildPromptFromFile } from '../migrator/features/llm';

console.log('=== What the LLM Actually Receives ===\n');

const templatePath = path.join(
    __dirname,
    '..',
    'ext_analyzer',
    'prompts',
    'extension-description.txt'
);

const examplePrompt = buildPromptFromFile(templatePath, {
    extension_name: 'Example Extension',
    manifest_summary:
        'Manifest.json: {"name": "Example", "version": "1.0", "permissions": ["tabs"]}',
    extension_files:
        'background.js:\nconsole.log("Hello World");\n\n---\n\ncontent.js:\ndocument.body.style.background = "red";',
});

console.log('The current code sends this to Ollama /api/generate endpoint:\n');
console.log('```');
console.log(examplePrompt);
console.log('```\n');

console.log('PROBLEM: The /api/generate endpoint treats this as a COMPLETION task.');
console.log('The model tries to CONTINUE the text, not FOLLOW the instructions.\n');

console.log(
    'SOLUTION: Use /api/chat endpoint instead, which separates instructions from content:\n'
);

const chatFormat = {
    model: 'your-model',
    messages: [
        {
            role: 'system',
            content:
                'You are a helpful research assistant which analyzes Chrome browser extensions and generates concise documentation.',
        },
        {
            role: 'user',
            content: `Extension Name: Example Extension
Manifest.json: {"name": "Example", "version": "1.0", "permissions": ["tabs"]}

Source Files:
background.js:
console.log("Hello World");

---

content.js:
document.body.style.background = "red";

Please analyze the extension above and generate documentation following these guidelines:
[... rest of instructions ...]`,
        },
    ],
};

console.log('Chat API format:');
console.log(JSON.stringify(chatFormat, null, 2));
