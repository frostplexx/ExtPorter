# Migration Guide: Ollama/SSH to GitHub Copilot API

This document describes the changes made to migrate from using Ollama with SSH tunneling to the GitHub Copilot API.

## Summary of Changes

The LLM infrastructure has been completely rewritten to use the GitHub Copilot API instead of self-hosted Ollama instances over SSH connections. This simplifies deployment, removes the need for SSH tunneling, and provides access to more powerful models.

## What Changed

### 1. Configuration

**Before (Ollama/SSH):**

```env
LLM_ENDPOINT=ssh://user@host:port/ollamaport
LLM_MODEL=deepseek-r1:1.5b
SSH_PASSWORD=your_password
SSH_LOCAL_PORT=11434
```

**After (GitHub Copilot):**

```env
GITHUB_TOKEN=your_github_token_here
COPILOT_ENDPOINT=https://api.githubcopilot.com
LLM_MODEL=gpt-4o
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=4000
LLM_TOP_P=0.85
```

### 2. Environment Variables

**Removed:**

- `LLM_ENDPOINT` (replaced by `COPILOT_ENDPOINT`)
- `SSH_PASSWORD`
- `SSH_PRIVATE_KEY_PATH`
- `SSH_LOCAL_PORT`
- `SSH_ENABLED`
- `SSH_HOST`
- `SSH_PORT`
- `SSH_USERNAME`
- `SSH_REMOTE_PORT`

**Added:**

- `GITHUB_TOKEN` - Your GitHub personal access token with Copilot access
- `COPILOT_API_KEY` - Alternative to GITHUB_TOKEN
- `COPILOT_ENDPOINT` - API endpoint (defaults to https://api.githubcopilot.com)
- `LLM_TEMPERATURE` - Temperature parameter (0-1, default: 0.2)
- `LLM_MAX_TOKENS` - Maximum tokens to generate (default: 4000)
- `LLM_TOP_P` - Top-p sampling parameter (default: 0.85)

**Changed:**

- `LLM_MODEL` - Now expects OpenAI-compatible model names like `gpt-4o`, `gpt-4`, `gpt-3.5-turbo`

### 3. Code Changes

#### Type Changes

**Before:**

```typescript
interface RemoteLLMConfig extends LLMConfig {
    ssh?: SSHConfig;
}
```

**After:**

```typescript
interface CopilotConfig extends LLMConfig {
    apiKey: string;
    endpoint?: string;
}

type RemoteLLMConfig = CopilotConfig;
```

#### API Changes

**Removed:**

- `SSHTunnel` class
- `SSHConfig` interface
- `loadSSHConfig()` function
- `isSSHEnabled()` function
- `ensureOllamaRunning()` function
- `service.isUsingSSHTunnel()` method

**Added:**

- `service.getModel()` - Returns the current model name
- `service.isConfigured()` - Checks if API key is configured

**Unchanged:**

- `LLMService` class (interface remains compatible)
- `generateChatCompletion()` method
- `generateCompletion()` method
- `llmManager` singleton

## Migration Steps

### 1. Get GitHub Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Give it a name like "ExtPorter LLM"
4. Select the `copilot` scope
5. Generate the token and save it securely

### 2. Update Environment Variables

Update your `.env` file:

```env
# Remove old Ollama/SSH configuration
# LLM_ENDPOINT=ssh://...
# SSH_PASSWORD=...
# etc.

# Add new GitHub Copilot configuration
GITHUB_TOKEN=ghp_your_token_here
LLM_MODEL=gpt-4o
LLM_TEMPERATURE=0.2
LLM_MAX_TOKENS=4000
LLM_TOP_P=0.85
```

### 3. Update Code (if using LLM service directly)

Most code should work without changes. If you're directly instantiating `LLMService`:

**Before:**

```typescript
const service = new LLMService({
    endpoint: 'http://localhost:11434',
    model: 'codellama:latest',
    temperature: 0.2,
    num_predict: 4000,
    top_k: 30,
});
```

**After:**

```typescript
const service = new LLMService({
    apiKey: 'your-token',
    model: 'gpt-4o',
    temperature: 0.2,
    max_tokens: 4000,
    top_p: 0.85,
});
```

### 4. Model Selection

Choose an appropriate model for your use case:

- `gpt-4o` - Latest GPT-4 Optimized (recommended)
- `gpt-4` - Standard GPT-4
- `gpt-3.5-turbo` - Faster, more economical option

See: https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-cli

## Benefits

1. **Simplified Setup**: No need for SSH tunneling or self-hosted Ollama
2. **Better Models**: Access to GPT-4 and other powerful models
3. **Reliability**: GitHub's infrastructure handles availability
4. **Scalability**: No resource constraints from self-hosted setup
5. **Security**: No SSH credentials to manage

## Troubleshooting

### "GitHub API token not configured"

Make sure you've set either `GITHUB_TOKEN` or `COPILOT_API_KEY` in your `.env` file.

### "API error (401): Unauthorized"

Your GitHub token might be expired or doesn't have the `copilot` scope. Generate a new token.

### "API error (403): Forbidden"

You might not have access to GitHub Copilot. Check your GitHub Copilot subscription.

### Empty responses

Try adjusting the `LLM_MAX_TOKENS` parameter or check the model's output in logs.

## Rollback

If you need to rollback to the Ollama/SSH setup, you can:

1. Restore the previous version from git: `git revert <commit-hash>`
2. Restore your old `.env` file from `.env.backup`
3. Reinstall dependencies if needed

## Questions?

For issues or questions about this migration, please open an issue on GitHub.
