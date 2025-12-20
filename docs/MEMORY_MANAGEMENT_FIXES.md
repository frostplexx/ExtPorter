# Memory Management Fixes for ExtPorter

## Problem Statement

The ExtPorter application was experiencing **Out of Memory (OOM) errors** with JavaScript heap usage reaching ~15GB, well beyond typical Node.js limits. This was causing the application to crash during large-scale extension migration.

## Root Causes Identified

1. **`MMapFile` eager loading** - Files were immediately read into memory in constructor, contrary to the "lazy loading" comment
2. **Unreleased file descriptors** - Original files remained loaded after transformation
3. **Unbounded caches** - LLM conversation history, file content cache, and log batches growing without limits
4. **Database queue overflow** - Operation queue could grow indefinitely during slow DB operations
5. **WebSocket connection leaks** - No timeout mechanism for inactive/stale connections
6. **Memory thresholds too low** - 1GB limits were too restrictive for the workload
7. **Inefficient garbage collection** - No automatic GC triggering when memory approaches limits

## Implemented Solutions

### 1. True Lazy Loading in `MMapFile` (`migrator/utils/memory_mapped_file.ts`)

```typescript
// Before: Files read immediately in constructor
constructor(filePath: string) {
    this.fd = openSync(filePath, 'r');
    this.buffer = Buffer.alloc(this.size);
    readSync(this.fd, this.buffer, 0, this.size, 0);
}

// After: True lazy loading
constructor(filePath: string) {
    this.path = filePath;
    this.fd = -1;
    this.size = statSync(filePath).size;  // Only get size
    this._loaded = false;
}

private ensureLoaded(): void {
    if (this._loaded) return;
    this.fd = openSync(this.path, 'r');
    try {
        this.buffer = Buffer.alloc(this.size);
        if (this.size > 0) {
            readSync(this.fd, this.buffer, 0, this.size, 0);
        }
    } finally {
        closeSync(this.fd);
        this.fd = -1;
    }
    this._loaded = true;
}
```

**Key improvements:**

- File content only read when first accessed via `getContent()` or `getBuffer()`
- File descriptor immediately closed after reading (prevents FD leaks)
- Added `releaseMemory()` method to free buffer while keeping file readable
- Added `isLoaded()` and `getMemoryUsage()` methods for monitoring

### 2. Enhanced File Management (`migrator/types/abstract_file.ts`)

```typescript
// New interface methods
export interface AbstractFile {
    // ... existing methods ...
    releaseMemory(): void; // NEW: Release memory but keep re-readable
}

// Updated LazyFile implementation
export class LazyFile implements AbstractFile {
    releaseMemory(): void {
        if (this._mmapFile) {
            this._mmapFile.releaseMemory();
        }
        this._ast = undefined;
        this._astParsed = false;
    }
}

// Helper for transformed files
export function createTransformedFile(
    originalFile: AbstractFile,
    newContent: string
): AbstractFile {
    const transformedFile = Object.create(LazyFile.prototype);
    // ... set up transformed file with new content ...

    // Release original file memory
    if (originalFile.releaseMemory) {
        originalFile.releaseMemory();
    }

    return transformedFile;
}
```

### 3. Higher Memory Thresholds (`migrator/utils/garbage.ts`)

```typescript
// Before: 1GB limits
const DEFAULT_MEMORY_WARN_LIMIT_GB = 1;
const DEFAULT_MEMORY_CRIT_LIMIT_GB = 1;

// After: 32GB limits (as requested)
const DEFAULT_MEMORY_WARN_LIMIT_GB = 24; // 24GB warning
const DEFAULT_MEMORY_CRIT_LIMIT_GB = 32; // 32GB critical
const DEFAULT_GC_TRIGGER_THRESHOLD_GB = 16; // Trigger GC at 16GB

// New utilities
export interface MemoryInfo {
    heapUsedGB: number;
    rssGB: number;
    // ... other fields
}

export function shouldTriggerGC(thresholdGB?: number): boolean;
export function periodicMemoryCheck(context: string): boolean;
export function aggressiveCleanup(extensions: Extension[]): void;
```

### 4. Database Queue Limits (`migrator/features/database/db_manager.ts`)

```typescript
// Added queue management
private readonly maxQueueSize: number = 1000;  // Prevent unbounded growth

// Backpressure mechanism
private async enqueueOperation<T>(operation: () => Promise<T>): Promise<T> {
    while (this.operationQueue.length >= this.maxQueueSize) {
        logger.warn(null, `Database queue full (${this.operationQueue.length}/${this.maxQueueSize}), waiting...`);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    // ... rest of implementation
}

export function getQueueStatus(): QueueStatus {
    return {
        queued: this.operationQueue.length,
        pending: this.pendingOperations,
        maxSize: this.maxQueueSize,
    };
}
```

### 5. Logger Batch Limits (`migrator/utils/logger.ts`)

```typescript
// Added batch size limits
const MAX_LOG_BATCH_SIZE = 100; // Prevent unbounded growth
let droppedLogCount = 0; // Track dropped logs

// Overflow handling
if (logBatch.length >= MAX_LOG_BATCH_SIZE) {
    const dropped = logBatch.splice(0, 10); // Drop oldest 10
    droppedLogCount += dropped.length;
    if (droppedLogCount % 100 === dropped.length) {
        console.warn(`[LOGGER] Dropped ${droppedLogCount} total logs due to batch overflow`);
    }
}

// Stats API
export function getStats(): LoggerStats {
    return {
        batchSize: logBatch.length,
        droppedCount: droppedLogCount,
        maxBatchSize: MAX_LOG_BATCH_SIZE,
    };
}
```

### 6. WebSocket Connection Management (`migrator/features/server/app.ts`)

```typescript
// Added connection timeouts and cleanup
private readonly connectionTimeout = 5 * 60 * 1000; // 5 minutes
private connectionTimers: Map<WebSocket, NodeJS.Timeout> = new Map();
private cleanupInterval: NodeJS.Timeout | null = null;

// Connection timeout handling
private resetConnectionTimeout(ws: WebSocket): void {
    this.clearConnectionTimeout(ws);
    const timer = setTimeout(() => {
        ws.close(1000, 'Inactivity timeout');
        this.connectedClients.delete(ws);
        this.connectionTimers.delete(ws);
    }, this.connectionTimeout);
    this.connectionTimers.set(ws, timer);
}

// Periodic cleanup
private periodicCleanup(): void {
    // Clean up dead connections
    // Clean up stale migrators
    // Check memory and trigger GC if needed
    const { logMemoryUsage, shouldTriggerGC, forceGarbageCollection } = require('../../utils/garbage');
    if (shouldTriggerGC(16)) {
        logMemoryUsage('periodic-cleanup-before-gc');
        forceGarbageCollection();
        logMemoryUsage('periodic-cleanup-after-gc');
    }
}
```

### 7. LLM Cache Management (`migrator/features/llm/extension-fixer.ts`)

```typescript
// Added cache size limits
private readonly maxFileCacheSize: number = 50;  // Maximum files to cache
private readonly maxConversationMessages: number = 100;  // Maximum conversation history

// Cache eviction (FIFO)
private async captureFileContentForDiff(filePath: string): Promise<void> {
    if (this.fileContentCache.size >= this.maxFileCacheSize) {
        const firstKey = this.fileContentCache.keys().next().value;
        if (firstKey) {
            this.fileContentCache.delete(firstKey);
        }
    }
    // ... rest of implementation
}

// Conversation history trimming
private trimConversationHistory(): void {
    if (this.conversationHistory.length <= this.maxConversationMessages) return;

    // Keep first (system) message and recent messages
    const toRemove = this.conversationHistory.length - this.maxConversationMessages;
    this.conversationHistory.splice(1, toRemove);
}

// Always cleanup
async fixExtension(): Promise<FixResult> {
    try {
        // ... migration logic
    } finally {
        this.cleanup();  // Always called
    }
}
```

## Test Coverage

### New Test Files Created

1. **`tests/unit/utils/memory_management.test.ts`** - Tests for all new memory management features
2. **`tests/unit/utils/memory_management_extended.test.ts`** - Extended integration tests with mocking

### Key Test Cases

```typescript
describe('Memory Management', () => {
    it('should not read file content in constructor', () => {
        const mmapFile = new MMapFile(testFile);
        expect(mmapFile.buffer).toBeNull(); // Should be null until accessed
        expect(mmapFile.isLoaded()).toBe(false);
    });

    it('should trigger GC at 16GB threshold', () => {
        expect(shouldTriggerGC(16)).toBe(true);
        expect(shouldTriggerGC(100)).toBe(false);
    });

    it('should handle database queue backpressure', async () => {
        // Test queue size limit enforcement
        // Test waiting behavior when queue is full
    });

    it('should drop oldest logs when batch overflow', () => {
        // Test batch size limit enforcement
        // Test dropped log tracking
    });
});
```

## Performance Impact

### Before Fixes

- **Memory Growth**: Linear, unbounded growth leading to OOM at ~15GB
- **File Descriptors**: Accumulated without cleanup
- **Queue Pressure**: No backpressure during high load
- **Connection Leaks**: Stale connections never cleaned up

### After Fixes

- **Memory Growth**: Bounded growth with automatic cleanup at configurable thresholds
- **File Descriptors**: Immediate closure after reading, proper resource release
- **Queue Pressure**: Backpressure prevents queue overflow, smooth processing
- **Connection Leaks**: 5-minute timeout with periodic cleanup
- **Predictable Memory**: 32GB critical threshold provides ample headroom
- **Better Monitoring**: Comprehensive memory statistics and alerting

## Configuration

### Environment Variables

```bash
# Memory thresholds
export MEMORY_CRIT_LIMIT=32    # Critical threshold in GB (default: 32)
export MEMORY_WARN_LIMIT=24      # Warning threshold in GB (default: 24)
export MEMORY_MONITORING=true   # Enable verbose memory logging

# Database queue
# No configuration needed - maxQueueSize is hardcoded to 1000

# Logger batching
# No configuration needed - MAX_LOG_BATCH_SIZE is hardcoded to 100
```

## Recommendations for Operation

### 1. Production Deployment

```bash
# Run with garbage collection enabled
node --expose-gc dist/index.js

# Set appropriate memory limits
export MEMORY_CRIT_LIMIT=32
export MEMORY_WARN_LIMIT=24
export MEMORY_MONITORING=true
```

### 2. Monitoring

- Monitor memory usage via the WebSocket API or logs
- Set up alerts for when memory approaches thresholds
- Use the periodic cleanup reports to track memory trends

### 3. Batch Size Tuning

- Default `MIGRATION_BATCH_SIZE` of 10 is now safe with memory fixes
- Can increase to 20-50 for faster processing if memory allows
- Monitor memory usage during processing and adjust batch size accordingly

### 4. Large-Scale Processing

- For processing >1000 extensions, consider:
    - Increasing `MEMORY_CRIT_LIMIT` to 48GB
    - Reducing concurrent operations
    - Processing in multiple smaller batches
    - Adding more frequent GC triggers

## Verification

To verify the fixes are working:

1. **Run tests**:

    ```bash
    npm test -- --testPathPatterns="memory"
    ```

2. **Monitor memory usage**:

    ```javascript
    // In browser console
    console.log(
        JSON.stringify({
            heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            timestamp: new Date().toISOString(),
        })
    );
    ```

3. **Check for memory leaks**:
    - Monitor heap growth during processing
    - Verify GC is being triggered appropriately
    - Ensure file descriptors are being released

## Files Modified

1. **Core Memory Management**:
    - `migrator/utils/memory_mapped_file.ts` - True lazy loading, memory release
    - `migrator/types/abstract_file.ts` - Resource cleanup, transformed file helper
    - `migrator/utils/garbage.ts` - Higher thresholds, periodic checks

2. **Database**:
    - `migrator/features/database/db_manager.ts` - Queue size limits, backpressure

3. **Logger**:
    - `migrator/utils/logger.ts` - Batch size limits, dropped log tracking

4. **Server**:
    - `migrator/features/server/app.ts` - Connection timeouts, periodic cleanup

5. **LLM Features**:
    - `migrator/features/llm/extension-fixer.ts` - Cache limits, conversation trimming

6. **Transformation Modules**:
    - `migrator/modules/api_renames/index.ts` - Original file cleanup
    - `migrator/modules/bridge_injector/file_transformer.ts` - Original file cleanup
    - `migrator/modules/web_request_migrator/file-transformer.ts` - Original file cleanup
    - `migrator/modules/service_worker_compat.ts` - Original file cleanup
    - `migrator/modules/offscreen_documents/service-worker-transformer.ts` - Original file cleanup

7. **Tests**:
    - `tests/unit/utils/memory_management.test.ts` - Core functionality tests
    - `tests/unit/utils/memory_management_extended.test.ts` - Integration tests

## Summary

These memory management fixes address the root causes of the OOM errors:

1. **Prevent unbounded memory growth** through lazy loading and cache limits
2. **Implement proper resource cleanup** throughout the file processing pipeline
3. **Add backpressure mechanisms** to prevent queue and log overflow
4. **Increase memory thresholds** to provide adequate headroom for large workloads
5. **Add periodic cleanup and monitoring** to detect and prevent memory leaks

The application should now be able to process thousands of extensions without running out of memory, with proper monitoring and automatic cleanup when approaching memory limits.
