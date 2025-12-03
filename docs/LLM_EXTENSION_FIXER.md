# LLM-Powered Extension Fixer

This feature uses an LLM (Large Language Model) with MCP (Model Context Protocol) to automatically fix broken Chrome extensions after MV2 to MV3 migration.

## Overview

The extension fixer:

1. Analyzes test reports to identify what's broken
2. Uses MCP tools to read/write extension files
3. Applies fixes based on MV3 best practices
4. Returns a summary of changes made

## Architecture

### Components

1. **MCPServer** (`mcp-server.ts`)
    - Provides file operation tools (read_file, write_file, list_files)
    - Ensures secure file access within extension directory
    - Executes tool requests from the LLM

2. **ExtensionFixer** (`extension-fixer.ts`)
    - Orchestrates the fixing process
    - Manages LLM conversation with tool calls
    - Tracks modified files
    - Returns structured fix results

3. **Server Handler** (`server/app.ts`)
    - WebSocket command: `FIX_EXTENSION:<extension_id>`
    - Fetches extension and test report from database
    - Coordinates between LLM service and fixer
    - Sends progress updates to client

## Usage

### From TUI Client

Send a WebSocket message:

```
FIX_EXTENSION:extension_id_here
```

### Response Format

Success:

```
FIX_EXTENSION_SUCCESS:extension_id:{"message":"Fixed popup registration in manifest","filesModified":["manifest.json","popup.js"]}
```

Error:

```
FIX_EXTENSION_ERROR:extension_id:Error message here
```

## How It Works

### 1. Initial Context Building

The fixer provides the LLM with:

- Extension name and ID
- Test report summary (what's broken)
- List of extension files
- Manifest.json content
- MCP tool descriptions

### 2. Interactive Fix Loop

The LLM can:

- List files to understand structure
- Read specific files to analyze issues
- Write files to apply fixes
- Request more context as needed

Example interaction:

```
LLM: TOOL_CALL: list_files
     PARAMS: {"directory": ""}

System: Returns list of all extension files

LLM: TOOL_CALL: read_file
     PARAMS: {"file_path": "manifest.json"}

System: Returns manifest.json content

LLM: TOOL_CALL: write_file
     PARAMS: {"file_path": "manifest.json", "content": "...fixed content..."}

System: File written successfully

LLM: DONE
     SUMMARY: Fixed service worker registration in manifest.json
```

### 3. Safety Features

- **Path Validation**: All file paths are validated to prevent directory traversal
- **Extension Sandboxing**: Each fixer instance is scoped to one extension directory
- **Iteration Limit**: Maximum 10 iterations to prevent infinite loops
- **Error Handling**: Graceful degradation on tool failures

## Common Fixes Applied

### Manifest Issues

- `background.scripts` → `background.service_worker`
- `browser_action` → `action`
- Missing `host_permissions`
- CSP violations

### Service Worker Issues

- Event listeners inside async functions → Top-level registration
- Background page patterns → Service worker patterns
- Storage API usage

### Popup/Options Issues

- Inline scripts → External scripts
- Missing CSP meta tags
- Incorrect file references

## Configuration

The fixer uses the existing LLM configuration from `.env`:

```bash
# LLM Configuration
OLLAMA_ENDPOINT=http://localhost:11434
OLLAMA_MODEL=deepseek-coder-v2:16b

# SSH Tunnel (optional)
SSH_ENABLED=true
SSH_HOST=your-remote-host
SSH_USER=your-username
SSH_LOCAL_PORT=11434
SSH_REMOTE_PORT=11434
```

## Limitations

- Requires a working LLM service (Ollama)
- Limited to text-based fixes (cannot fix binary files)
- May require multiple attempts for complex issues
- Depends on test report quality

## Future Improvements

- [ ] Add validation of fixes before writing
- [ ] Support for multi-file refactoring
- [ ] Integration with automated testing
- [ ] Learning from successful fixes
- [ ] Support for custom fix strategies

## Example

```typescript
import { llmManager, ExtensionFixer } from './features/llm';

// Get LLM service
const llmService = await llmManager.getService();

// Create fixer
const fixer = await ExtensionFixer.fromExtension(llmService, extension, testReport);

// Run fix
const result = await fixer.fixExtension();

if (result.success) {
    console.log('Fixed!', result.message);
    console.log('Modified files:', result.filesModified);
} else {
    console.error('Fix failed:', result.error);
}
```

## Debugging

Enable verbose logging:

```bash
DEBUG=llm:* yarn start
```

Check server console for:

- `[LLM Fixer]` - Fix process logs
- Tool execution logs
- LLM responses
- Error stack traces
