# Fakeium Validation - Quick Start Guide

## ✅ Integration Complete!

Fakeium validation is now integrated into the ExtPorter migration pipeline.

## 🚀 Quick Start

### 1. Test a Single Extension

```bash
# Test validation on a single extension
yarn test:fakeium:extension tests/fixtures/mock-extensions/callback_extension
```

### 2. Enable for Full Pipeline

```bash
# Enable fakeium validation for all extensions
export ENABLE_FAKEIUM_VALIDATION=true

# Run migration
yarn dev path/to/extensions path/to/output
```

### 3. Or Use .env File

```bash
# Add to .env file
echo "ENABLE_FAKEIUM_VALIDATION=true" >> .env
echo "FAKEIUM_TIMEOUT=15000" >> .env

# Run normally
yarn dev path/to/extensions path/to/output
```

## 📊 What You'll See

### During Migration

For each extension:
```
[INFO] Extension: example-ext - Starting fakeium validation
[INFO] Extension: example-ext - Fakeium validation PASSED (87.3% similarity)
  matched: 12
  mv2_only: 2
  mv3_only: 1
  duration_ms: 1234
```

Or if issues detected:
```
[WARN] Extension: example-ext - Fakeium validation FAILED (45.2% similarity)
  matched: 5
  mv2_only: 8
  mv3_only: 3
  differences: ["Found 8 MV2-specific API calls..."]
  duration_ms: 987
```

### In Database

Validation results are saved with each migrated extension:

```javascript
{
  "id": "example-extension",
  "name": "Example Extension",
  "fakeium_validation": {
    "enabled": true,
    "is_equivalent": true,
    "similarity_score": 0.873,
    "mv2_api_calls": 15,
    "mv3_api_calls": 14,
    "matched_calls": 12,
    "mv2_only_calls": 2,
    "mv3_only_calls": 1,
    "differences": [],
    "validation_errors": [],
    "duration_ms": 1234
  }
}
```

## 🔧 Configuration Options

```bash
# Enable/disable validation (default: false)
ENABLE_FAKEIUM_VALIDATION=true

# Timeout per extension (default: 10000ms)
FAKEIUM_TIMEOUT=15000

# Batch size (default: 10)
MIGRATION_BATCH_SIZE=10
```

## 📈 Query Results

Find failed validations in MongoDB:

```javascript
// Extensions with failed validation
db.migrated_extensions.find({
  "fakeium_validation.enabled": true,
  "fakeium_validation.is_equivalent": false
})

// Extensions with low similarity
db.migrated_extensions.find({
  "fakeium_validation.similarity_score": { $lt: 0.7 }
})

// Count total validated
db.migrated_extensions.countDocuments({
  "fakeium_validation.enabled": true
})
```

## 📚 Available Commands

```bash
# Demo - shows basic fakeium usage
yarn test:fakeium

# Unit tests - tests comparator logic
yarn test:fakeium:unit

# Single extension - validates one extension
yarn test:fakeium:extension path/to/extension

# Full pipeline - migrates with validation
ENABLE_FAKEIUM_VALIDATION=true yarn dev input output
```

## 🎯 Understanding Results

| Similarity Score | Meaning | Action |
|-----------------|---------|--------|
| 90-100% | ✓ Excellent | Migration succeeded |
| 70-89% | ✓ Good | Review minor differences |
| 40-69% | ⚠️ Fair | Review MV2-only calls |
| 0-39% | ✗ Poor | Major migration issues |

## 🛠️ What Gets Validated

**API Coverage:**
- ✅ chrome.extension.* → chrome.runtime.*
- ✅ chrome.browserAction.* → chrome.action.*
- ✅ chrome.pageAction.* → chrome.action.*
- ✅ chrome.tabs.* (including deprecated methods)
- ✅ chrome.storage.*
- ✅ chrome.scripting.* (MV3)

**Detection:**
- ✅ Static API calls
- ✅ Dynamic calls (eval, new Function)
- ✅ Obfuscated code
- ✅ Callback transformations
- ✅ Parameter restructuring

**Limitations:**
- ❌ UI/Visual rendering
- ❌ Real browser interactions
- ❌ Network requests
- ❌ Timing-dependent behavior

## 🔍 Example Workflow

```bash
# 1. Test on single extension first
yarn test:fakeium:extension tests/fixtures/mock-extensions/callback_extension

# 2. Enable for small batch
ENABLE_FAKEIUM_VALIDATION=true MIGRATION_BATCH_SIZE=5 yarn dev ./sample_extensions ./output

# 3. Review results
# Check logs for PASSED/FAILED

# 4. Query MongoDB for failures
mongosh migrator -u admin -p password --eval '
  db.migrated_extensions.find({
    "fakeium_validation.is_equivalent": false
  }).forEach(ext => print(ext.name + ": " + ext.fakeium_validation.similarity_score))
'

# 5. Enable for full batch
ENABLE_FAKEIUM_VALIDATION=true yarn dev ./all_extensions ./output
```

## 🐛 Troubleshooting

### No API Calls Detected
- Extension may have no top-level code execution
- APIs might be in event listeners (not executed immediately)
- Try extensions with background scripts

### Validation Times Out
```bash
export FAKEIUM_TIMEOUT=30000  # Increase to 30 seconds
```

### Memory Issues
```bash
export MIGRATION_BATCH_SIZE=5  # Reduce batch size
```

### Always Shows 100% Similarity with 0 Calls
- Extension code isn't executing (event listeners only)
- No Chrome API usage in top-level code
- This is normal for many extensions

## 📖 More Information

- `FAKEIUM_VALIDATION.md` - Detailed documentation
- `tests/fakeium/README.md` - Technical details
- `tests/fakeium/demo.ts` - Usage examples

## ✨ What's Integrated

1. **Migration Module** - `migrator/modules/fakeium_validator.ts`
2. **Pipeline Integration** - Runs after API renames, before write
3. **Database Storage** - Results saved with each extension
4. **Configuration** - Environment variable controls
5. **Testing Tools** - Single extension test script
6. **Documentation** - Complete guides and examples

## 🎉 Ready to Use!

The system is production-ready. Start with a small batch to verify, then scale up!
