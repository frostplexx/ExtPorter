# Fakeium Validation Integration

This document describes how to use fakeium validation in the ExtPorter migration pipeline.

## Overview

Fakeium validation runs both the original MV2 and migrated MV3 extension code in lightweight V8 sandboxes and compares their behaviors to ensure the migration preserved functionality.

**Status**: ✅ Fully functional - API call detection working correctly across all test extensions.

### Recent Fix (Oct 2024)

The validation system was experiencing 0 API call detection due to two issues:
1. **Hook vs Injection**: Originally tried to use `fakeium.hook()` with JavaScript objects, but fakeium cannot clone function objects. Fixed by injecting Chrome API mocks as executable JavaScript code that runs in the sandbox.
2. **Browser Namespace**: Extensions use both `chrome.*` and `browser.*` namespaces. Fixed by supporting both namespaces in the mocks and normalizing them during comparison.

**Results after fix**:
- callback_extension: 39 matched API calls (100% similarity)
- no_callback_extension: 41 matched API calls (100% similarity)
- popup-extension: 103 matched API calls (100% similarity)

## Enabling Validation

Set the following environment variable to enable fakeium validation:

```bash
export ENABLE_FAKEIUM_VALIDATION=true
```

### Optional Configuration

```bash
# Timeout for fakeium execution (default: 10000ms = 10 seconds)
export FAKEIUM_TIMEOUT=10000

# Batch size for processing extensions (default: 10)
export MIGRATION_BATCH_SIZE=10

# Enable verbose logging for debugging
export FAKEIUM_VERBOSE=true

# Memory limits (in GB)
export MEMORY_WARN_LIMIT=1.0   # Warn when memory exceeds 1GB
export MEMORY_CRIT_LIMIT=3.0   # Stop processing when memory exceeds 3GB
```

## Running with Validation

```bash
# Using environment variable
ENABLE_FAKEIUM_VALIDATION=true yarn dev path/to/extensions path/to/output

# Or add to .env file
echo "ENABLE_FAKEIUM_VALIDATION=true" >> .env
echo "FAKEIUM_TIMEOUT=15000" >> .env
yarn dev path/to/extensions path/to/output
```

## Validation Results

For each extension, validation results are stored in the `fakeium_validation` field:

```typescript
{
  enabled: boolean;              // Whether validation ran
  is_equivalent: boolean;        // true if migration passed validation
  similarity_score: number;      // 0-1 score of behavior similarity
  mv2_api_calls: number;         // Number of API calls in MV2 version
  mv3_api_calls: number;         // Number of API calls in MV3 version
  matched_calls: number;         // Number of equivalent API calls
  mv2_only_calls: number;        // API calls only in MV2
  mv3_only_calls: number;        // API calls only in MV3
  differences: string[];         // List of detected differences
  validation_errors: string[];   // Errors during validation
  duration_ms: number;           // Validation execution time
}
```

## Log Output

### Validation Passed
```
[INFO] Extension: example-extension - Fakeium validation PASSED (85.7% similarity)
  matched: 12
  mv2_only: 2
  mv3_only: 2
  duration_ms: 1234
```

### Validation Failed
```
[WARN] Extension: example-extension - Fakeium validation FAILED (45.2% similarity)
  matched: 5
  mv2_only: 8
  mv3_only: 3
  differences: ["Found 8 MV2-specific API calls that may not be properly migrated"]
  duration_ms: 987
```

## Interpreting Results

### High Similarity (>70%)
Migration successfully preserved most API behaviors. Minor differences are acceptable (e.g., legitimate API renames).

### Medium Similarity (40-70%)
Migration may have issues. Review:
- `mv2_only_calls`: MV2 APIs that weren't transformed
- `mv3_only_calls`: New MV3 APIs that may be incorrect
- `differences`: Specific issues detected

### Low Similarity (<40%)
Significant migration problems detected:
- Many MV2 APIs not properly migrated
- Substantial behavioral changes
- Review migration logic for this extension

## What Validation Tests

Fakeium validation compares:

1. **API Call Patterns**
   - Detects calls to `chrome.*` and `browser.*` APIs (both namespaces supported)
   - Matches equivalent APIs (e.g., `chrome.extension.*` → `chrome.runtime.*`)
   - Tracks both GetEvent (property access) and CallEvent (function calls)
   - Identifies missing transformations

2. **Execution Behavior**
   - Captures behavior from `eval()` and `new Function()`
   - Detects obfuscated code API usage
   - Finds dynamic API calls missed by static analysis
   - Executes code in isolated V8 sandbox for safety

3. **Transformation Accuracy**
   - Validates parameter transformations
   - Checks API rename completeness
   - Identifies semantic differences
   - Normalizes browser/chrome namespace for comparison

## What Validation Does NOT Test

- UI/Visual rendering
- Real browser integration
- Network requests
- DOM manipulation
- Timing/async behavior
- Multi-tab interactions

For comprehensive testing, use Puppeteer tests after fakeium validation.

## Performance Impact

- **Per Extension**: ~1-5 seconds additional processing time
- **Memory**: Minimal per extension (~5-10MB), automatically cleaned up after each extension
- **Batch Processing**: Compatible with batch mode
- **Parallel**: Runs after migration, doesn't block writing

### Memory Optimizations

Fakeium validation includes several memory optimizations:

1. **Automatic Cleanup**: Raw event logs and API call details are cleared immediately after comparison
2. **Lightweight Storage**: Only summary statistics (scores, counts) are kept in memory and database
3. **Sandbox Disposal**: V8 sandbox instances are properly disposed after each validation
4. **Differences Limit**: Only first 5 differences are stored to prevent memory bloat

If you encounter memory issues with large batches:
```bash
# Reduce batch size
export MIGRATION_BATCH_SIZE=5

# Increase memory limits
export MEMORY_CRIT_LIMIT=4.0  # Allow up to 4GB before stopping

# Or temporarily disable validation for large runs
unset ENABLE_FAKEIUM_VALIDATION
```

## Querying Validation Results

Since validation results are stored in the database with each migrated extension:

```javascript
// MongoDB query for failed validations
db.migrated_extensions.find({
  "fakeium_validation.enabled": true,
  "fakeium_validation.is_equivalent": false
})

// Query for high similarity but still failed
db.migrated_extensions.find({
  "fakeium_validation.similarity_score": { $gt: 0.6, $lt: 0.7 }
})

// Query for specific errors
db.migrated_extensions.find({
  "fakeium_validation.validation_errors": { $exists: true, $ne: [] }
})
```

## Troubleshooting

### Validation Times Out
Increase timeout:
```bash
export FAKEIUM_TIMEOUT=30000  # 30 seconds
```

### High Memory Usage
- Reduce batch size: `MIGRATION_BATCH_SIZE=5`
- Validation respects existing memory limits
- Extensions are cleaned up after validation

### Validation Always Fails
- Check that extensions have JavaScript files
- Ensure APIs are mocked in `migrator/features/fakeium/chrome-api-injection.ts`
- Review logs for specific errors
- Enable verbose mode: `FAKEIUM_VERBOSE=true`

### Extension Skipped
If an extension has no JavaScript files or parsing errors, validation may be skipped. Check:
```
fakeium_validation.validation_errors
```

## Adding New API Mocks

To support additional Chrome APIs:

1. **Add mock to `migrator/features/fakeium/chrome-api-injection.ts`**:

   Update both `generateMV2ChromeAPI()` and `generateMV3ChromeAPI()`:
   ```typescript
   // In MV2 (callback-based):
   newApi: {
       method: function(arg1, arg2, callback) {
           if (callback) callback(result);
       }
   }

   // In MV3 (promise-based):
   newApi: {
       method: function(arg1, arg2) {
           return Promise.resolve(result);
       }
   }
   ```

   Note: Both `chrome` and `browser` namespaces are automatically supported.

2. **Add equivalence mapping in `migrator/features/fakeium/BehaviorComparator.ts`**:
   ```typescript
   const API_EQUIVALENTS: { [mv2Path: string]: string } = {
       'chrome.oldApi.method': 'chrome.newApi.method',
       // ...
   };
   ```

3. **Test the mock**:
   ```bash
   yarn test:fakeium
   # Or test on a specific extension:
   yarn test:fakeium:extension path/to/extension
   ```

## Example Workflow

```bash
# 1. Enable validation
export ENABLE_FAKEIUM_VALIDATION=true

# 2. Run migration
yarn dev ./input_extensions ./output_extensions

# 3. Review results
# Check logs for PASSED/FAILED status

# 4. Query database for failed validations
# Use MongoDB queries to find problematic extensions

# 5. Manual review
# Inspect extensions with low similarity scores

# 6. Final validation with Puppeteer
yarn test:puppeteer
```

## Best Practices

1. **Use for batch processing**: Ideal for testing many extensions quickly
2. **Combine with static analysis**: Fakeium catches what AST misses
3. **Review failures**: Not all failures are critical
4. **Iterate on API mocks**: Add mocks as you encounter new APIs
5. **Set realistic timeouts**: Balance thoroughness vs speed
6. **Monitor similarity scores**: Track improvements over time

## See Also

- `migrator/features/fakeium/README.md` - Technical documentation
- `migrator/features/fakeium/chrome-api-injection.ts` - Chrome API mocks
- `migrator/features/fakeium/BehaviorComparator.ts` - API equivalence mapping
- `migrator/modules/fakeium_validator.ts` - Pipeline integration
- `QUICKSTART_FAKEIUM.md` - Quick start guide
