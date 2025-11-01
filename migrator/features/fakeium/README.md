# Fakeium-Based Extension Migration Validation

This directory contains a lightweight, fast testing framework for validating Chrome extension migrations from Manifest V2 to V3 using [fakeium](https://github.com/josemmo/fakeium).

## Overview

Fakeium provides a V8-based sandbox that can execute extension JavaScript code and capture all Chrome API calls without launching a full browser instance. This makes it:

- **Fast**: Executes in seconds instead of minutes (compared to Puppeteer)
- **Scalable**: Can test hundreds of extensions quickly
- **Comprehensive**: Detects API calls from `eval`, `new Function`, and obfuscated code that static analysis might miss
- **Accurate**: Validates that MV2→MV3 migrations preserve extension functionality

## Architecture

### Components

1. **`types.ts`** - TypeScript type definitions for API calls, behaviors, and comparisons
2. **`chrome-api-mocks.ts`** - Mock implementations of Chrome Extension APIs for both MV2 and MV3
3. **`FakeiumRunner.ts`** - Orchestrator for running extensions in fakeium sandbox
4. **`BehaviorComparator.ts`** - Compares MV2 vs MV3 behaviors to validate migrations
5. **`extension-validator.test.ts`** - Jest test suite

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    Extension Files (JS)                          │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FakeiumRunner                                │
│  - Creates fakeium sandbox                                       │
│  - Sets up Chrome API mocks (MV2 or MV3)                        │
│  - Executes extension code                                       │
│  - Captures all API calls                                        │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  ExtensionBehavior                               │
│  - List of API calls made                                        │
│  - Arguments passed                                              │
│  - Source location                                               │
│  - Execution errors                                              │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 BehaviorComparator                               │
│  - Compares MV2 vs MV3 behaviors                                │
│  - Maps equivalent APIs (extension.* → runtime.*)               │
│  - Calculates similarity score                                   │
│  - Generates validation report                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

### Running Tests

```bash
# Run all fakeium tests
yarn test:fakeium

# Run with verbose output
yarn test:fakeium --verbose

# Run specific test
yarn test:fakeium -t "should detect chrome.storage API calls"
```

### Programmatic Usage

```typescript
import { FakeiumRunner } from './tests/fakeium/FakeiumRunner';
import { BehaviorComparator } from './tests/fakeium/BehaviorComparator';
import { Extension } from './migrator/types/extension';

// Load your extension
const mv2Extension: Extension = loadExtension('path/to/mv2/extension');
const mv3Extension: Extension = loadExtension('path/to/mv3/extension');

// Run both versions
const mv2Result = await FakeiumRunner.runExtension(mv2Extension, 2);
const mv3Result = await FakeiumRunner.runExtension(mv3Extension, 3);

// Compare behaviors
const comparison = BehaviorComparator.compare(
    mv2Result.behavior,
    mv3Result.behavior
);

// Generate report
const report = BehaviorComparator.generateReport(comparison);
console.log(report);

// Check if migration is valid
if (comparison.isEquivalent) {
    console.log('✓ Migration successful!');
} else {
    console.log('✗ Migration issues detected');
    console.log('Differences:', comparison.differences);
}
```

### Running Specific Script Types

```typescript
// Run only background scripts
const bgResult = await FakeiumRunner.runBackgroundScript(extension, 2);

// Run only content scripts
const csResult = await FakeiumRunner.runContentScripts(extension, 2);
```

## Chrome API Mocks

The framework mocks the following Chrome Extension APIs:

### Manifest V2 APIs

- `chrome.extension.*` (getURL, sendMessage, connect, etc.)
- `chrome.browserAction.*` (setTitle, setBadgeText, onClicked, etc.)
- `chrome.pageAction.*` (show, hide, setTitle, etc.)
- `chrome.tabs.*` (including deprecated methods like `getAllInWindow`, `getSelected`)
- `chrome.storage.*` (sync, local)
- `chrome.runtime.*` (available in both MV2 and MV3)

### Manifest V3 APIs

- `chrome.runtime.*` (getURL, sendMessage, connect, etc.)
- `chrome.action.*` (replaces browserAction and pageAction)
- `chrome.tabs.*` (without deprecated methods)
- `chrome.scripting.*` (executeScript, insertCSS)
- `chrome.storage.*` (sync, local)

## API Mapping

The BehaviorComparator understands these MV2→MV3 equivalences:

| MV2 API | MV3 API |
|---------|---------|
| `chrome.extension.getURL` | `chrome.runtime.getURL` |
| `chrome.extension.sendMessage` | `chrome.runtime.sendMessage` |
| `chrome.browserAction.*` | `chrome.action.*` |
| `chrome.pageAction.*` | `chrome.action.*` |
| `chrome.tabs.executeScript` | `chrome.scripting.executeScript` |
| `chrome.tabs.getAllInWindow` | `chrome.tabs.query` |
| `chrome.tabs.getSelected` | `chrome.tabs.query` |
| `chrome.tabs.onActiveChanged` | `chrome.tabs.onActivated` |

## Validation Criteria

A migration is considered successful if:

1. **High similarity score** (>70%) - Most API calls are matched
2. **Few differences** (<3) - Minimal behavioral changes detected
3. **Low unmatched count** (<5) - Few unaccounted API calls
4. **Equivalent functionality** - MV2 APIs properly transformed to MV3 equivalents

## Example Output

```
=== Migration Validation Report ===

Overall Status: ✓ PASSED
Similarity Score: 92.3%

Matched API Calls: 12
MV2-Only Calls: 1
MV3-Only Calls: 1

API Calls in MV2 but not MV3:
  - chrome.browserAction.setBadgeText (CallEvent)

API Calls in MV3 but not MV2:
  - chrome.action.setBadgeText (CallEvent)
```

## Integration with Migration Pipeline

You can integrate fakeium validation into the migration pipeline:

```typescript
import { MigrationPipeline } from './migrator/index';
import { FakeiumRunner } from './tests/fakeium/FakeiumRunner';
import { BehaviorComparator } from './tests/fakeium/BehaviorComparator';

// After migration
const originalExtension = await loadExtension('path/to/original');
const migratedExtension = await MigrationPipeline.migrate(originalExtension);

// Validate with fakeium
const mv2Behavior = await FakeiumRunner.runExtension(originalExtension, 2);
const mv3Behavior = await FakeiumRunner.runExtension(migratedExtension, 3);

const comparison = BehaviorComparator.compare(
    mv2Behavior.behavior,
    mv3Behavior.behavior
);

if (!comparison.isEquivalent) {
    console.warn('Migration validation failed:', comparison.differences);
    // Optionally: mark extension for manual review
}
```

## Limitations

1. **Not a full browser**: Cannot test UI interactions, DOM manipulation, or visual rendering
2. **Simplified context**: Extensions run in isolation without real tabs, windows, or network
3. **Mock APIs**: API responses are simulated and may not reflect real Chrome behavior
4. **No async timing**: Cannot test timing-dependent behavior or race conditions
5. **Limited webRequest**: Complex webRequest scenarios may not be fully captured

## When to Use

**Use fakeium for:**
- ✅ Fast validation of API usage patterns
- ✅ Detecting missing migration transformations
- ✅ Batch testing many extensions
- ✅ Catching obvious migration errors
- ✅ Detecting API calls in obfuscated code

**Use Puppeteer for:**
- ⚠️  Testing actual extension behavior in browser
- ⚠️  UI/UX validation
- ⚠️  Complex webRequest scenarios
- ⚠️  Integration with real websites
- ⚠️  Final validation before deployment

## Best Practices

1. **Run fakeium tests first** for quick feedback, then Puppeteer for thorough validation
2. **Combine with static analysis** - fakeium catches what AST analysis misses
3. **Review unmatched calls** - They may indicate legitimate differences or migration issues
4. **Use verbose mode** during development to see execution details
5. **Set appropriate timeouts** for complex extensions

## Troubleshooting

### Test Times Out

Increase timeout in options:
```typescript
await FakeiumRunner.runExtension(extension, 2, { timeout: 60000 });
```

### No API Calls Detected

- Ensure extension files are being executed
- Check that code doesn't rely on real DOM or async initialization
- Use `verbose: true` to see execution logs

### False Negatives in Comparison

- Review `BehaviorComparator.API_EQUIVALENTS` mapping
- Some parameter transformations may need custom handling
- Check similarity threshold in `determinateEquivalence()`

## Contributing

To add support for additional Chrome APIs:

1. Add mock implementation to `chrome-api-mocks.ts`
2. Add equivalence mapping to `BehaviorComparator.API_EQUIVALENTS`
3. Add test case to `extension-validator.test.ts`

## References

- [Fakeium Documentation](https://github.com/josemmo/fakeium)
- [Chrome Extension API](https://developer.chrome.com/docs/extensions/reference/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
