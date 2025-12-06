/**
 * Example: Using OpenCode SDK for LLM interactions
 *
 * This example demonstrates how to use the OpenCode SDK to interact with LLMs
 * instead of calling the GitHub Copilot API directly.
 */

import { opencodeManager } from '../migrator/features/llm';

async function main() {
    console.log('OpenCode SDK Example\n');

    try {
        // Get the OpenCode service (automatically initializes)
        console.log('Initializing OpenCode service...');
        const llm = await opencodeManager.getService();
        console.log(`✓ Connected to OpenCode`);
        console.log(`✓ Using model: ${llm.getModel()}\n`);

        // Example 1: Simple completion
        console.log('Example 1: Simple Completion');
        console.log('─'.repeat(50));
        const simplePrompt = 'Explain what a Chrome extension manifest is in 2 sentences.';
        console.log(`Prompt: ${simplePrompt}\n`);

        const simpleResult = await llm.generateCompletion(simplePrompt, false);
        console.log(`Response: ${simpleResult}\n`);

        // Example 2: Chat completion with context
        console.log('Example 2: Chat Completion with Context');
        console.log('─'.repeat(50));

        const chatResult = await llm.generateChatCompletion(
            [
                {
                    role: 'system',
                    content: 'You are an expert at migrating Chrome extensions to Firefox.',
                },
                {
                    role: 'user',
                    content:
                        'How do I convert chrome.storage.sync to work in both Chrome and Firefox?',
                },
            ],
            { streamToConsole: false }
        );

        console.log(`Response: ${chatResult}\n`);

        // Example 3: Multiple interactions
        console.log('Example 3: Multiple Interactions (Reusing Session)');
        console.log('─'.repeat(50));

        const questions = [
            'What is the browser namespace in WebExtensions?',
            'How do I detect which browser my extension is running in?',
        ];

        for (const question of questions) {
            console.log(`Q: ${question}`);
            const answer = await llm.generateCompletion(question, false);
            console.log(`A: ${answer}\n`);
        }

        // Cleanup
        console.log('Cleaning up...');
        await opencodeManager.cleanup();
        console.log('✓ Cleanup complete');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

export { main };
