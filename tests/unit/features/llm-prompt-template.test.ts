import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
    buildPromptFromFile,
    buildPromptFromString,
    validateTemplate,
    getTemplatePlaceholders,
    promptToChatMessages,
    buildChatMessagesFromFile,
} from '../../../migrator/features/llm/prompt-template';

describe('Prompt Template', () => {
    const testTemplateDir = path.join('/tmp', `test-templates-${Date.now()}`);
    const testTemplatePath = path.join(testTemplateDir, 'test-template.txt');

    beforeAll(() => {
        // Create test template directory and files
        fs.mkdirSync(testTemplateDir, { recursive: true });
        fs.writeFileSync(testTemplatePath, 'Hello {{name}}, you are {{age}} years old', 'utf8');
    });

    afterAll(() => {
        // Clean up test files
        if (fs.existsSync(testTemplateDir)) {
            fs.rmSync(testTemplateDir, { recursive: true, force: true });
        }
    });

    describe('buildPromptFromString', () => {
        it('should replace placeholders with values', () => {
            const template = 'Hello {{name}}, you are {{age}} years old';
            const variables = { name: 'John', age: 25 };

            const result = buildPromptFromString(template, variables);

            expect(result).toBe('Hello John, you are 25 years old');
        });

        it('should handle boolean values', () => {
            const template = 'Is active: {{active}}';
            const variables = { active: true };

            const result = buildPromptFromString(template, variables);

            expect(result).toBe('Is active: true');
        });

        it('should handle null values as empty strings', () => {
            const template = 'Value: {{value}}';
            const variables = { value: null };

            const result = buildPromptFromString(template, variables);

            expect(result).toBe('Value: ');
        });

        it('should throw error for missing placeholders', () => {
            const template = 'Hello {{name}}, you are {{age}} years old';
            const variables = { name: 'John' };

            expect(() => buildPromptFromString(template, variables)).toThrow(
                'Missing value for placeholder: {{age}}'
            );
        });

        it('should handle multiple occurrences of same placeholder', () => {
            const template = '{{name}} likes {{name}}';
            const variables = { name: 'Bob' };

            const result = buildPromptFromString(template, variables);

            expect(result).toBe('Bob likes Bob');
        });

        it('should handle templates with no placeholders', () => {
            const template = 'No placeholders here';
            const variables = {};

            const result = buildPromptFromString(template, variables);

            expect(result).toBe('No placeholders here');
        });

        it('should handle numbers in placeholder values', () => {
            const template = 'Count: {{count}}';
            const variables = { count: 42 };

            const result = buildPromptFromString(template, variables);

            expect(result).toBe('Count: 42');
        });
    });

    describe('buildPromptFromFile', () => {
        it('should load and replace placeholders from file', () => {
            const variables = { name: 'Alice', age: 30 };

            const result = buildPromptFromFile(testTemplatePath, variables);

            expect(result).toBe('Hello Alice, you are 30 years old');
        });

        it('should throw error for non-existent file', () => {
            const variables = { name: 'John' };

            expect(() => buildPromptFromFile('/nonexistent/path.txt', variables)).toThrow(
                'Failed to read template file'
            );
        });
    });

    describe('validateTemplate', () => {
        it('should validate template with expected placeholders', () => {
            const result = validateTemplate(testTemplatePath, ['name', 'age']);

            expect(result).toBe(true);
        });

        it('should throw error when expected placeholder is missing', () => {
            expect(() => validateTemplate(testTemplatePath, ['name', 'age', 'missing'])).toThrow(
                'missing expected placeholder: {{missing}}'
            );
        });

        it('should return true when no expected placeholders specified', () => {
            const result = validateTemplate(testTemplatePath);

            expect(result).toBe(true);
        });

        it('should throw error for non-existent file', () => {
            expect(() => validateTemplate('/nonexistent/path.txt', ['test'])).toThrow();
        });
    });

    describe('getTemplatePlaceholders', () => {
        it('should return all placeholders from template', () => {
            const placeholders = getTemplatePlaceholders(testTemplatePath);

            expect(placeholders).toEqual(['name', 'age']);
        });

        it('should return empty array for template without placeholders', () => {
            const noPlaceholderPath = path.join(testTemplateDir, 'no-placeholder.txt');
            fs.writeFileSync(noPlaceholderPath, 'No placeholders here', 'utf8');

            const placeholders = getTemplatePlaceholders(noPlaceholderPath);

            expect(placeholders).toEqual([]);
        });

        it('should return unique placeholders', () => {
            const duplicatePath = path.join(testTemplateDir, 'duplicate.txt');
            fs.writeFileSync(duplicatePath, '{{test}} and {{test}} and {{other}}', 'utf8');

            const placeholders = getTemplatePlaceholders(duplicatePath);

            expect(placeholders).toEqual(['test', 'other']);
        });

        it('should throw error for non-existent file', () => {
            expect(() => getTemplatePlaceholders('/nonexistent/path.txt')).toThrow();
        });
    });

    describe('promptToChatMessages', () => {
        it('should split prompt into system and user messages', () => {
            const prompt =
                'You are a helpful assistant.\n\nExtension Name: Test Extension\nCode: function() {}';

            const messages = promptToChatMessages(prompt);

            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe('You are a helpful assistant.');
            expect(messages[1].role).toBe('user');
            expect(messages[1].content).toContain('Extension Name: Test Extension');
        });

        it('should handle custom system end marker', () => {
            const prompt = 'System instructions\n\n---MARKER---\nUser content';

            const messages = promptToChatMessages(prompt, '---MARKER---');

            expect(messages).toHaveLength(2);
            expect(messages[0].content).toBe('System instructions');
            expect(messages[1].content).toContain('User content');
        });

        it('should handle prompt without clear separation', () => {
            const prompt = 'Just some text without markers';

            const messages = promptToChatMessages(prompt);

            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe(
                'You are a helpful assistant that follows instructions carefully.'
            );
            expect(messages[1].role).toBe('user');
            expect(messages[1].content).toBe(prompt);
        });

        it('should use default marker for Extension:', () => {
            const prompt = 'Instructions here\n\nExtension: MyExt\nDetails';

            const messages = promptToChatMessages(prompt);

            expect(messages).toHaveLength(2);
            expect(messages[0].content).toBe('Instructions here');
            expect(messages[1].content).toContain('Extension: MyExt');
        });
    });

    describe('buildChatMessagesFromFile', () => {
        it('should build chat messages from template file', () => {
            const chatTemplatePath = path.join(testTemplateDir, 'chat-template.txt');
            fs.writeFileSync(
                chatTemplatePath,
                'System: Process {{type}}\n\nExtension Name: {{name}}',
                'utf8'
            );

            const variables = { type: 'JavaScript', name: 'TestExt' };
            const messages = buildChatMessagesFromFile(chatTemplatePath, variables);

            expect(messages).toHaveLength(2);
            expect(messages[0].role).toBe('system');
            expect(messages[0].content).toBe('System: Process JavaScript');
            expect(messages[1].role).toBe('user');
            expect(messages[1].content).toContain('Extension Name: TestExt');
        });

        it('should handle custom system end marker', () => {
            const chatTemplatePath = path.join(testTemplateDir, 'chat-marker.txt');
            fs.writeFileSync(chatTemplatePath, 'Instructions\n\n---END---\nData: {{data}}', 'utf8');

            const variables = { data: 'test' };
            const messages = buildChatMessagesFromFile(chatTemplatePath, variables, '---END---');

            expect(messages).toHaveLength(2);
            expect(messages[1].content).toContain('Data: test');
        });

        it('should throw error for missing template file', () => {
            const variables = { test: 'value' };

            expect(() => buildChatMessagesFromFile('/nonexistent/path.txt', variables)).toThrow();
        });
    });
});
