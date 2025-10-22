#!/usr/bin/env ts-node

/**
 * Example demonstrating the prompt template system
 *
 * This shows how to:
 * 1. Build prompts from template files
 * 2. Build prompts from template strings
 * 3. Validate templates
 * 4. List placeholders in templates
 */

import * as path from 'path';
import {
    buildPromptFromFile,
    buildPromptFromString,
    validateTemplate,
    getTemplatePlaceholders,
} from '../migrator/features/llm';

console.log('=== Prompt Template System Examples ===\n');

// Example 1: Build prompt from string
console.log('1. Building prompt from string:');
const template = 'Hello {{name}}, you are {{age}} years old and work as a {{job}}.';
const prompt1 = buildPromptFromString(template, {
    name: 'Alice',
    age: 30,
    job: 'Software Engineer',
});
console.log(`Template: ${template}`);
console.log(`Result: ${prompt1}\n`);

// Example 2: Build prompt from file
console.log('2. Building prompt from file:');
const templatePath = path.join(
    __dirname,
    '..',
    'ext_analyzer',
    'prompts',
    'extension-description.txt'
);
try {
    const prompt2 = buildPromptFromFile(templatePath, {
        extension_name: 'Example Extension',
        manifest_summary: 'Manifest.json: {"name": "Example", "version": "1.0"}',
        extension_files:
            'background.js:\nconsole.log("Hello");\n\n---\n\ncontent.js:\nconsole.log("World");',
    });
    console.log(`Template file: ${templatePath}`);
    console.log(`Result length: ${prompt2.length} characters`);
    console.log(`First 200 chars: ${prompt2.substring(0, 200)}...\n`);
} catch (error: any) {
    console.log(`Error: ${error.message}\n`);
}

// Example 3: List placeholders in a template
console.log('3. Listing placeholders in template:');
try {
    const placeholders = getTemplatePlaceholders(templatePath);
    console.log(`Template: ${templatePath}`);
    console.log(`Placeholders found: ${placeholders.join(', ')}\n`);
} catch (error: any) {
    console.log(`Error: ${error.message}\n`);
}

// Example 4: Validate template
console.log('4. Validating template:');
try {
    const isValid = validateTemplate(templatePath, [
        'extension_name',
        'manifest_summary',
        'extension_files',
    ]);
    console.log(`Template is valid: ${isValid}\n`);
} catch (error: any) {
    console.log(`Validation error: ${error.message}\n`);
}

// Example 5: Error handling - missing variable
console.log('5. Error handling - missing variable:');
try {
    buildPromptFromString('Hello {{name}}', { age: 25 });
} catch (error: any) {
    console.log(`Expected error: ${error.message}\n`);
}

// Example 6: Complex template with multiple variables
console.log('6. Complex template example:');
const complexTemplate = `
Analyze the following code:

File: {{filename}}
Language: {{language}}
Author: {{author}}
Lines of code: {{loc}}

Code:
{{code}}

Please provide a detailed review focusing on {{focus_area}}.
`.trim();

const prompt6 = buildPromptFromString(complexTemplate, {
    filename: 'example.ts',
    language: 'TypeScript',
    author: 'Alice',
    loc: 150,
    code: 'function hello() { return "world"; }',
    focus_area: 'code quality and best practices',
});

console.log(prompt6);
console.log('\n=== Examples Complete ===');
