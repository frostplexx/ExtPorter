import * as fs from 'fs';
import { ChatMessage } from './types';

/**
 * Variables that can be used in prompt templates
 */
export type PromptVariables = Record<string, string | number | boolean | null | undefined>;

/**
 * Loads a prompt template from a file and replaces placeholders with provided variables
 *
 * @param templatePath - Path to the template file
 * @param variables - Object containing variable values to replace in the template
 * @returns The rendered prompt with all variables replaced
 *
 * @example
 * // Template file content: "Hello {{name}}, you are {{age}} years old"
 * const prompt = buildPromptFromFile('./template.txt', { name: 'John', age: 25 });
 * // Result: "Hello John, you are 25 years old"
 */
export function buildPromptFromFile(templatePath: string, variables: PromptVariables): string {
    // Read the template file
    let template: string;
    try {
        template = fs.readFileSync(templatePath, 'utf-8');
    } catch (error: any) {
        throw new Error(`Failed to read template file at ${templatePath}: ${error.message}`);
    }

    return buildPromptFromString(template, variables);
}

/**
 * Builds a prompt from a template string by replacing placeholders with provided variables
 *
 * @param template - The template string with {{variable}} placeholders
 * @param variables - Object containing variable values to replace in the template
 * @returns The rendered prompt with all variables replaced
 *
 * @example
 * const template = "Hello {{name}}, you are {{age}} years old";
 * const prompt = buildPromptFromString(template, { name: 'John', age: 25 });
 * // Result: "Hello John, you are 25 years old"
 */
export function buildPromptFromString(template: string, variables: PromptVariables): string {
    let result = template;

    // Find all placeholders in the template
    const placeholderRegex = /\{\{(\w+)\}\}/g;
    const placeholders = new Set<string>();
    let match;

    while ((match = placeholderRegex.exec(template)) !== null) {
        placeholders.add(match[1]);
    }

    // Replace each placeholder with its value
    for (const placeholder of placeholders) {
        const value = variables[placeholder];

        if (value === undefined) {
            throw new Error(`Missing value for placeholder: {{${placeholder}}}`);
        }

        // Convert value to string
        const stringValue = value === null ? '' : String(value);

        // Replace all occurrences of this placeholder
        const placeholderPattern = new RegExp(`\\{\\{${placeholder}\\}\\}`, 'g');
        result = result.replace(placeholderPattern, stringValue);
    }

    return result;
}

/**
 * Validates that a template file exists and contains the expected placeholders
 *
 * @param templatePath - Path to the template file
 * @param expectedPlaceholders - Optional array of placeholder names that should exist in the template
 * @returns True if valid, throws error otherwise
 */
export function validateTemplate(templatePath: string, expectedPlaceholders?: string[]): boolean {
    const template = fs.readFileSync(templatePath, 'utf-8');

    if (expectedPlaceholders) {
        const placeholderRegex = /\{\{(\w+)\}\}/g;
        const foundPlaceholders = new Set<string>();
        let match;

        while ((match = placeholderRegex.exec(template)) !== null) {
            foundPlaceholders.add(match[1]);
        }

        for (const expected of expectedPlaceholders) {
            if (!foundPlaceholders.has(expected)) {
                throw new Error(
                    `Template ${templatePath} is missing expected placeholder: {{${expected}}}`
                );
            }
        }
    }

    return true;
}

/**
 * Lists all placeholders found in a template file
 *
 * @param templatePath - Path to the template file
 * @returns Array of placeholder names found in the template
 */
export function getTemplatePlaceholders(templatePath: string): string[] {
    const template = fs.readFileSync(templatePath, 'utf-8');
    const placeholderRegex = /\{\{(\w+)\}\}/g;
    const placeholders = new Set<string>();
    let match;

    while ((match = placeholderRegex.exec(template)) !== null) {
        placeholders.add(match[1]);
    }

    return Array.from(placeholders);
}

/**
 * Splits a rendered template into system and user chat messages
 * Expects the template to have a format where the first paragraph(s) are system instructions,
 * followed by content that should be in the user message
 *
 * @param renderedPrompt - The fully rendered prompt string
 * @param systemEndMarker - Optional marker to identify where system prompt ends (default: looks for first "Extension Name:" or similar)
 * @returns Array of ChatMessage objects for use with chat API
 *
 * @example
 * const messages = promptToChatMessages(renderedPrompt);
 * // Result: [
 * //   { role: 'system', content: 'You are a helpful assistant...' },
 * //   { role: 'user', content: 'Extension Name: ...' }
 * // ]
 */
export function promptToChatMessages(
    renderedPrompt: string,
    systemEndMarker?: string
): ChatMessage[] {
    // Find where system instructions end and user content begins
    // Default: look for "Extension Name:" or "Extension:" as the start of user content
    const marker = systemEndMarker || /^(Extension Name:|Extension:)/m;

    const match = renderedPrompt.match(marker);

    if (!match || match.index === undefined) {
        // No clear separation found, treat entire prompt as user message with generic system prompt
        return [
            {
                role: 'system',
                content: 'You are a helpful assistant that follows instructions carefully.',
            },
            {
                role: 'user',
                content: renderedPrompt,
            },
        ];
    }

    // Split at the marker
    const systemContent = renderedPrompt.substring(0, match.index).trim();
    const userContent = renderedPrompt.substring(match.index).trim();

    return [
        {
            role: 'system',
            content: systemContent,
        },
        {
            role: 'user',
            content: userContent,
        },
    ];
}

/**
 * Builds chat messages from a template file
 * Convenience function that combines buildPromptFromFile and promptToChatMessages
 *
 * @param templatePath - Path to the template file
 * @param variables - Object containing variable values to replace in the template
 * @param systemEndMarker - Optional marker to identify where system prompt ends
 * @returns Array of ChatMessage objects for use with chat API
 */
export function buildChatMessagesFromFile(
    templatePath: string,
    variables: PromptVariables,
    systemEndMarker?: string
): ChatMessage[] {
    const rendered = buildPromptFromFile(templatePath, variables);
    return promptToChatMessages(rendered, systemEndMarker);
}
