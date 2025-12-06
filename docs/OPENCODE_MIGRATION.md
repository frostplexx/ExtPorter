# Migration Guide: GitHub Copilot API to OpenCode SDK

This document describes how to migrate from using the GitHub Copilot API directly to using OpenCode's SDK for LLM interactions.

## Summary of Changes

ExtPorter now supports **two LLM backends**:

1. **GitHub Copilot API** (Legacy) - Direct API calls to GitHub's Copilot service
2. **OpenCode SDK** (Recommended) - Use OpenCode to interact with any LLM provider

The OpenCode SDK approach is recommended because:

- Access to multiple LLM providers (Anthropic, OpenAI, Google, etc.)
- Better token management and context handling
- Built-in tooling and debugging capabilities
- More flexible configuration

## What Changed

### 1. New Files Added

**OpenCode Implementation:**

- `migrator/features/llm/opencode-service.ts` - OpenCode SDK service wrapper
- `migrator/features/llm/opencode-config.ts` - OpenCode configuration loader
- `migrator/features/llm/opencode-manager.ts` - Singleton manager for OpenCode service

**Legacy Files (Unchanged):**

- `migrator/features/llm/llm-service.ts` - GitHub Copilot API service
- `migrator/features/llm/config.ts` - GitHub Copilot configuration
- `migrator/features/llm/llm-manager.ts` - GitHub Copilot manager

### 2. Configuration Changes

#### Before (Copilot Only):

```env
GITHUB_TOKEN=ghp_your_token_here
COPILOT_ENDPOINT=https://api.githubcopilot.com
LLM_MODEL=gpt-4o
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=4000
LLM_TOP_P=0.85
```

#### After (OpenCode - Recommended):

```env
# Model format: "provider/model"
LLM_MODEL=anthropic/claude-3-5-sonnet-20241022

# OpenCode server settings
OPENCODE_PORT=4096
OPENCODE_HOSTNAME=127.0.0.1
OPENCODE_USE_EXTERNAL=false  # Set to true to use existing OpenCode instance

# Generation parameters
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=4000
LLM_TOP_P=0.85
```

### 3. Code Changes

#### Using the Legacy Copilot Service:

```typescript
import { llmManager } from './features/llm';

// Get service instance
const llmService = await llmManager.getService();

// Generate completion
const result = await llmService.generateChatCompletion([{ role: 'user', content: 'Hello!' }]);

// Cleanup when done
await llmManager.cleanup();
```

#### Using the New OpenCode Service:

```typescript
import { opencodeManager } from './features/llm';

// Get service instance
const opencodeService = await opencodeManager.getService();

// Generate completion (same interface!)
const result = await opencodeService.generateChatCompletion([{ role: 'user', content: 'Hello!' }]);

// Cleanup when done
await opencodeManager.cleanup();
```

### 4. Model Selection

#### Copilot Models (Legacy):

- `gpt-4o` - Latest GPT-4 Optimized
- `gpt-4` - Standard GPT-4
- `gpt-3.5-turbo` - Faster, economical option

#### OpenCode Models (Format: `provider/model`):

**Anthropic (Recommended):**

- `anthropic/claude-3-5-sonnet-20241022` - Best for code
- `anthropic/claude-3-opus-20240229` - Most capable
- `anthropic/claude-3-haiku-20240307` - Fastest

**OpenAI:**

- `openai/gpt-4` - Standard GPT-4
- `openai/gpt-4-turbo` - Latest GPT-4 Turbo
- `openai/gpt-3.5-turbo` - Economical

**Google:**

- `google/gemini-pro` - Google's flagship model

See [OpenCode providers](https://opencode.ai/docs/providers) for more options.

## Migration Steps

### Option 1: Migrate to OpenCode (Recommended)

1. **Install OpenCode** (if not already installed):

    ```bash
    curl -fsSL https://opencode.ai/install | bash
    # or
    npm install -g opencode-ai
    ```

2. **Configure OpenCode providers**:

    Run OpenCode and configure your LLM provider:

    ```bash
    opencode
    ```

    Then use `/connect` to configure your provider (Anthropic, OpenAI, etc.)

3. **Update your `.env` file**:

    ```env
    # Remove or comment out Copilot config
    # GITHUB_TOKEN=...
    # COPILOT_ENDPOINT=...

    # Add OpenCode config
    LLM_MODEL=anthropic/claude-3-5-sonnet-20241022
    OPENCODE_PORT=4096
    OPENCODE_HOSTNAME=127.0.0.1
    OPENCODE_USE_EXTERNAL=false
    ```

4. **Update your code** to use `opencodeManager`:

    ```typescript
    // Before
    import { llmManager } from './features/llm';
    const service = await llmManager.getService();

    // After
    import { opencodeManager } from './features/llm';
    const service = await opencodeManager.getService();
    ```

5. **Test the migration**:

    ```bash
    npm test
    ```

### Option 2: Keep Using Copilot

No changes needed! The legacy Copilot implementation remains fully functional.

### Option 3: Use External OpenCode Instance

If you already have OpenCode running in your terminal:

1. **Update `.env`**:

    ```env
    LLM_MODEL=anthropic/claude-3-5-sonnet-20241022
    OPENCODE_PORT=4096
    OPENCODE_HOSTNAME=127.0.0.1
    OPENCODE_USE_EXTERNAL=true  # Connect to existing instance
    ```

2. **Use the OpenCode service** - it will connect to your running instance instead of starting a new server.

## Benefits of OpenCode

### 1. Multi-Provider Support

Access any LLM provider through a single interface:

- Anthropic (Claude)
- OpenAI (GPT-4)
- Google (Gemini)
- And more...

### 2. Better Context Management

OpenCode handles context windows intelligently, preventing token limit issues.

### 3. Built-in Tooling

OpenCode provides built-in tools for:

- File operations
- Code search
- Symbol lookup
- And more...

### 4. Cost Optimization

Choose the best model for each task:

- Use fast models (Haiku) for simple tasks
- Use powerful models (Opus/Sonnet) for complex tasks

### 5. Debugging

OpenCode provides better visibility into:

- Token usage
- API calls
- Response streaming
- Error handling

## Architecture Differences

### GitHub Copilot API (Direct):

```
ExtPorter → HTTP Request → GitHub Copilot API → Response
```

Pros:

- Simple, direct API calls
- No additional dependencies

Cons:

- Limited to GitHub Copilot models only
- Manual error handling
- No built-in tooling

### OpenCode SDK:

```
ExtPorter → OpenCode SDK → OpenCode Server → LLM Provider → Response
```

Pros:

- Access to any LLM provider
- Automatic context management
- Built-in tools and debugging
- Session management

Cons:

- Requires OpenCode installation
- Additional layer (but provides value)

## Troubleshooting

### "Failed to initialize OpenCode service"

**Cause**: OpenCode server failed to start or connection failed.

**Solutions**:

1. Check if OpenCode is installed: `opencode --version`
2. Ensure port is available: `lsof -i :4096`
3. Check configuration in `.env`
4. Try using external instance: `OPENCODE_USE_EXTERNAL=true`

### "Invalid model format"

**Cause**: Model string not in `provider/model` format.

**Solution**: Use format like `anthropic/claude-3-5-sonnet-20241022`

### "No text content in OpenCode response"

**Cause**: Response format issue.

**Solutions**:

1. Check OpenCode logs
2. Verify model is available
3. Check token limits

### Performance Concerns

**If OpenCode seems slow**:

1. Use `OPENCODE_USE_EXTERNAL=true` to reuse existing instance
2. Choose faster models (e.g., `claude-3-haiku`)
3. Reduce `LLM_MAX_TOKENS` if appropriate

## API Compatibility

Both `LLMService` (Copilot) and `OpencodeService` implement the same interface:

```typescript
interface LLMServiceInterface {
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    generateChatCompletion(messages: ChatMessage[], options?: GenerationOptions): Promise<string>;
    generateCompletion(prompt: string, streamToConsole?: boolean): Promise<string>;
    getModel(): string;
    isConfigured(): boolean;
}
```

This means you can switch between them without changing your code (just swap the manager).

## Rollback

To rollback to Copilot-only:

1. **Restore `.env`**:

    ```env
    GITHUB_TOKEN=your_token_here
    LLM_MODEL=gpt-4o
    ```

2. **Update code** to use `llmManager` instead of `opencodeManager`

3. **Uninstall OpenCode SDK** (optional):
    ```bash
    npm uninstall @opencode-ai/sdk
    ```

## Performance Comparison

| Feature            | Copilot API | OpenCode SDK         |
| ------------------ | ----------- | -------------------- |
| Providers          | GitHub only | Multiple             |
| Setup              | Simple      | Moderate             |
| Context Management | Manual      | Automatic            |
| Tooling            | None        | Built-in             |
| Debugging          | Limited     | Excellent            |
| Cost               | Fixed       | Flexible             |
| Speed              | Fast        | Fast (with external) |

## Questions?

For issues or questions:

- OpenCode documentation: https://opencode.ai/docs
- ExtPorter issues: https://github.com/frostplexx/ExtPorter/issues
- OpenCode Discord: https://opencode.ai/discord
