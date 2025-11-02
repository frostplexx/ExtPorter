# Extension Clustering Modules

This directory contains modular components for the extension clustering system.

## Modules

### Core Types
- **types.ts** - TypeScript interfaces and type definitions

### API Analysis
- **api_patterns.ts** - Chrome API categorization and patterns
- **api_extractor.ts** - API extraction and vectorization utilities

### Data Loading
- **database_loader.ts** - MongoDB integration with query builder

### Filtering
- **filter_engine.ts** - Advanced multi-dimensional filtering

## Usage

These modules are used by the main clustering script:

```typescript
import { ExtensionMetadata, FilterCriteria } from './clustering/types';
import { ALL_CHROME_APIS, getApiCategory } from './clustering/api_patterns';
import { extractAPIUsage, apiUsageToVector } from './clustering/api_extractor';
import { DatabaseExtensionLoader } from './clustering/database_loader';
import { ExtensionFilterEngine } from './clustering/filter_engine';
```

## Architecture

```
Main Script (cluster_extensions.ts)
├── Types (types.ts)
├── API Patterns (api_patterns.ts)
├── API Extractor (api_extractor.ts)
├── Database Loader (database_loader.ts)
└── Filter Engine (filter_engine.ts)
```

## See Also

- [Enhanced Features Guide](../CLUSTERING_ENHANCED.md)
- [Quick Start Guide](../CLUSTERING_QUICK_START.md)
- [Comprehensive Guide](../README_CLUSTERING.md)
