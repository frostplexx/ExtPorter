# Chat API Upgrade

## Problem

The LLM was responding with messages like "I can't help you deceive users" because the code was using Ollama's `/api/generate` (completion) endpoint, which treats the entire prompt as text to *continue* rather than instructions to *follow*.

## Solution

Upgraded to use Ollama's `/api/chat` endpoint, which properly separates:
- **System message**: Instructions about the LLM's role and behavior
- **User message**: The actual content to analyze

## Changes Made

### 1. New Types (`types.ts`)
```typescript
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface GenerationOptions {
    useChat?: boolean;
    streamToConsole?: boolean;
}
```

### 2. New LLM Service Method (`llm-service.ts`)
- Added `generateChatCompletion(messages, options)` - Uses `/api/chat` endpoint
- Kept `generateCompletion(prompt)` for backward compatibility

### 3. Enhanced Prompt Templates (`prompt-template.ts`)
New functions:
- `promptToChatMessages(renderedPrompt)` - Splits prompt into system/user messages
- `buildChatMessagesFromFile(templatePath, variables)` - Convenience function

### 4. Updated Extension Analyzer (`extension-actions.ts`)
Now uses:
```typescript
const messages = buildChatMessagesFromFile(templatePath, variables);
const response = await llmService.generateChatCompletion(messages);
```

## How It Works

### Old Way (Completion API)
```
POST /api/generate
{
  "prompt": "You are a helpful assistant...\n\nExtension Name: Foo\n..."
}
```
→ LLM tries to **continue** this text, not follow it as instructions

### New Way (Chat API)
```
POST /api/chat
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant..." },
    { "role": "user", "content": "Extension Name: Foo\n..." }
  ]
}
```
→ LLM treats system as **instructions** and user as **content to analyze**

## Template Format

Templates are automatically split at the first occurrence of "Extension Name:" or "Extension:":

```
You are a helpful assistant...    ← System message
[instructions about behavior]

Extension Name: {{name}}          ← User message starts here
{{manifest}}
...
```

## Benefits

1. ✅ LLM properly follows instructions
2. ✅ No more "trying to deceive users" errors
3. ✅ Better separation of concerns
4. ✅ Backward compatible (old API still available)
5. ✅ Clear system/user message split in temp files

## Testing

Run the test scripts to see the difference:
```bash
npx ts-node examples/show-actual-llm-request.ts
npx ts-node examples/test-chat-api.ts
```

## Migration Guide

### For Existing Code

**Old:**
```typescript
const prompt = buildPromptFromFile(templatePath, variables);
const response = await llmService.generateCompletion(prompt);
```

**New:**
```typescript
const messages = buildChatMessagesFromFile(templatePath, variables);
const response = await llmService.generateChatCompletion(messages);
```

### For New Templates

Structure your templates like this:
```
[System instructions - what the LLM should do]

Extension Name: {{extension_name}}
[User content - what to analyze]
```

The split happens automatically at "Extension Name:" or "Extension:".
