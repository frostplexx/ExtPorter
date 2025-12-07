# LLM Integration Guide

ExtPorter supports AI-powered extension migration using Large Language Models (LLMs). This guide covers how to configure and use LLM features.

## Quick Start

### 1. Choose Your LLM Backend

ExtPorter supports two LLM backends:

- **OpenCode SDK** (Recommended) - Access multiple LLM providers through OpenCode
- **GitHub Copilot API** (Legacy) - Direct integration with GitHub Copilot

### 2. Setup OpenCode (Recommended)

```bash
# Install OpenCode
curl -fsSL https://opencode.ai/install | bash

# Configure your provider
opencode
# Then run: /connect
```

### 3. Configure Environment

```env
# .env file
LLM_MODEL=anthropic/claude-3-5-sonnet-20241022
OPENCODE_PORT=4096
OPENCODE_USE_EXTERNAL=false
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=4000
```

### 4. Use in Code

```typescript
import { opencodeManager } from './features/llm';

// Get LLM service
const llm = await opencodeManager.getService();

// Generate completion
const result = await llm.generateChatCompletion([
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Fix this JavaScript code...' },
]);

// Cleanup
await opencodeManager.cleanup();
```

## Configuration Options

### OpenCode SDK Configuration

| Variable                | Description                      | Default                                |
| ----------------------- | -------------------------------- | -------------------------------------- |
| `LLM_MODEL`             | Model in `provider/model` format | `anthropic/claude-3-5-sonnet-20241022` |
| `OPENCODE_PORT`         | Port for OpenCode server         | `4096`                                 |
| `OPENCODE_HOSTNAME`     | Hostname for OpenCode server     | `127.0.0.1`                            |
| `OPENCODE_USE_EXTERNAL` | Use existing OpenCode instance   | `false`                                |
| `LLM_TEMPERATURE`       | Sampling temperature (0-1)       | `0.2`                                  |
| `LLM_MAX_TOKENS`        | Maximum tokens to generate       | `4000`                                 |
| `LLM_TOP_P`             | Top-p sampling parameter         | `0.85`                                 |

### GitHub Copilot Configuration

| Variable           | Description                  | Default                         |
| ------------------ | ---------------------------- | ------------------------------- |
| `GITHUB_TOKEN`     | GitHub personal access token | -                               |
| `COPILOT_API_KEY`  | Alternative to GITHUB_TOKEN  | -                               |
| `COPILOT_ENDPOINT` | Copilot API endpoint         | `https://api.githubcopilot.com` |
| `LLM_MODEL`        | Model name (e.g., `gpt-4o`)  | `gpt-4o`                        |

## Available Models

### OpenCode SDK

#### Anthropic (Best for code)

- `anthropic/claude-3-5-sonnet-20241022` - Best balance of speed/quality
- `anthropic/claude-3-opus-20240229` - Most capable
- `anthropic/claude-3-haiku-20240307` - Fastest and cheapest

#### OpenAI

- `openai/gpt-4-turbo` - Latest GPT-4 Turbo
- `openai/gpt-4` - Standard GPT-4
- `openai/gpt-3.5-turbo` - Fast and economical

#### Google

- `google/gemini-pro` - Google's flagship model

See [OpenCode providers](https://opencode.ai/docs/providers) for complete list.

### GitHub Copilot

- `gpt-4o` - GPT-4 Optimized (recommended)
- `gpt-4` - Standard GPT-4
- `gpt-3.5-turbo` - Faster option

## Usage Patterns

### Basic Completion

```typescript
import { opencodeManager } from './features/llm';

const llm = await opencodeManager.getService();

const response = await llm.generateCompletion(
    'Explain this code: function add(a, b) { return a + b; }'
);

console.log(response);
```

### Chat Completion

```typescript
const response = await llm.generateChatCompletion([
    {
        role: 'system',
        content: 'You are an expert at migrating Chrome extensions to Firefox.',
    },
    {
        role: 'user',
        content: 'How do I convert chrome.storage.sync to browser.storage.sync?',
    },
]);
```

### Using Templates

```typescript
import { buildPromptFromFile, promptToChatMessages } from './features/llm';

// Load prompt template
const prompt = buildPromptFromFile('./prompts/fix-extension.txt', {
    extensionCode: code,
    errorMessage: error,
});

// Convert to chat messages
const messages = promptToChatMessages(prompt);

// Generate
const result = await llm.generateChatCompletion(messages);
```

### Streaming Output

```typescript
// Stream to console (default)
const result = await llm.generateCompletion(prompt, true);

// Silent mode
const result = await llm.generateCompletion(prompt, false);
```

## Advanced Features

### Extension Fixer

Automatically fix extension errors using LLM:

```typescript
import { ExtensionFixer } from './features/llm';

const fixer = new ExtensionFixer();

const result = await fixer.fixExtension({
    extensionPath: './path/to/extension',
    errorMessage: 'ReferenceError: chrome is not defined',
    maxAttempts: 3,
});

if (result.success) {
    console.log('Extension fixed!');
    console.log(result.changes);
}
```

### MCP Server Integration

OpenCode supports Model Context Protocol (MCP) servers for extended capabilities:

```typescript
import { MCPServer } from './features/llm';

// Start MCP server
const mcp = new MCPServer({
    port: 5000,
    tools: ['code-search', 'file-ops'],
});

await mcp.start();

// Use with OpenCode
// MCP tools are automatically available to the LLM
```

## Best Practices

### 1. Choose the Right Model

```typescript
// For simple tasks (fast and cheap)
const simpleModel = 'anthropic/claude-3-haiku-20240307';

// For complex migrations (better quality)
const complexModel = 'anthropic/claude-3-5-sonnet-20241022';

// For critical fixes (best quality)
const criticalModel = 'anthropic/claude-3-opus-20240229';
```

### 2. Manage Context

```typescript
// Keep prompts focused
const messages = [
    { role: 'system', content: 'Brief system message' },
    { role: 'user', content: 'Specific question' },
];

// Avoid including entire codebases
// Instead, extract relevant parts
```

### 3. Handle Errors

```typescript
import { opencodeManager } from './features/llm';

async function safeGenerate(prompt: string): Promise<string> {
    const llm = await opencodeManager.getService();

    try {
        return await llm.generateCompletion(prompt);
    } catch (error) {
        console.error('LLM generation failed:', error);

        // Fallback logic
        return 'Could not generate response';
    } finally {
        // Cleanup is handled by manager
    }
}
```

### 4. Resource Management

```typescript
// Use the manager for automatic resource management
const llm = await opencodeManager.getService();

// Make multiple calls without re-initializing
const result1 = await llm.generateCompletion('prompt 1');
const result2 = await llm.generateCompletion('prompt 2');

// Manager handles cleanup automatically on process exit
// Or manually cleanup when done
await opencodeManager.cleanup();
```

### 5. External OpenCode Instance

For better performance when making many requests:

```bash
# Start OpenCode in separate terminal
opencode

# In your .env
OPENCODE_USE_EXTERNAL=true
```

This reuses the existing OpenCode instance, avoiding startup overhead.

## Troubleshooting

### Issue: "OpenCode service not initialized"

**Solution**: Always call `initialize()` before using:

```typescript
const llm = await opencodeManager.getService(); // Automatically initializes
```

### Issue: "Invalid model format"

**Solution**: Use correct format:

```typescript
// ✅ Correct
LLM_MODEL = anthropic / claude - 3 - 5 - sonnet - 20241022;

// ❌ Wrong
LLM_MODEL = claude - 3 - 5 - sonnet - 20241022;
```

### Issue: Slow responses

**Solutions**:

1. Use external OpenCode instance (`OPENCODE_USE_EXTERNAL=true`)
2. Choose faster model (e.g., `claude-3-haiku`)
3. Reduce `LLM_MAX_TOKENS`

### Issue: Token limit exceeded

**Solutions**:

1. Reduce prompt size
2. Increase `LLM_MAX_TOKENS` (if provider allows)
3. Split into multiple requests

## Migration Guides

- [GitHub Copilot API → OpenCode SDK](./OPENCODE_MIGRATION.md)
- [Ollama/SSH → GitHub Copilot API](./COPILOT_MIGRATION.md)

## API Reference

### OpencodeService

```typescript
class OpencodeService {
    constructor(config: OpencodeConfig);
    static fromEnv(): OpencodeService;

    initialize(): Promise<void>;
    cleanup(): Promise<void>;

    generateChatCompletion(messages: ChatMessage[], options?: GenerationOptions): Promise<string>;

    generateCompletion(prompt: string, streamToConsole?: boolean): Promise<string>;

    getModel(): string;
    isConfigured(): boolean;
}
```

### LLMService (Legacy)

```typescript
class LLMService {
    constructor(config: CopilotConfig)
    static fromEnv(): LLMService

    // Same methods as OpencodeService
    initialize(): Promise<void>
    cleanup(): Promise<void>
    generateChatCompletion(...): Promise<string>
    generateCompletion(...): Promise<string>
    getModel(): string
    isConfigured(): boolean
}
```

### Managers

```typescript
// OpenCode manager (recommended)
import { opencodeManager } from './features/llm';
const service = await opencodeManager.getService();

// Copilot manager (legacy)
import { llmManager } from './features/llm';
const service = await llmManager.getService();
```

## Examples

See the `examples/` directory for complete examples:

- `examples/basic-completion.ts` - Simple completion
- `examples/chat-completion.ts` - Multi-turn conversation
- `examples/extension-fixer.ts` - Automated extension fixing
- `examples/template-usage.ts` - Using prompt templates

## Resources

- [OpenCode Documentation](https://opencode.ai/docs)
- [OpenCode SDK Reference](https://opencode.ai/docs/sdk)
- [OpenCode Providers](https://opencode.ai/docs/providers)
- [GitHub Copilot Docs](https://docs.github.com/en/copilot)

## Support

For issues and questions:

- ExtPorter Issues: https://github.com/frostplexx/ExtPorter/issues
- OpenCode Discord: https://opencode.ai/discord
