# Extension Clustering Modules

This directory contains modular components for the extension clustering system.

## Modules

### Core Clustering

- **clustering_utils.ts** - Core clustering algorithms and utilities
    - Dynamic API extraction from extension code (AST-based with regex fallback)
    - K-means clustering with silhouette analysis for optimal cluster count
    - Cluster naming based on common API patterns
    - MV2→MV3 migration detection

- **extension_loader.ts** - Extension data loading from multiple sources
    - Load from filesystem directories
    - Load from MongoDB database
    - Load from migrated output directories
    - API domain grouping and statistics

- **output_formatter.ts** - Enhanced output formatting and statistics
    - Overall dataset statistics (extensions, APIs, sources, migration status)
    - Detailed cluster analysis with complexity metrics
    - API domain usage analysis
    - Migration recommendations with priority rankings
    - Actionable insights and recommendations

### Supporting Modules

- **types.ts** - TypeScript type definitions for all clustering data structures
- **api_patterns.ts** - Predefined Chrome API categorization and patterns
- **api_extractor.ts** - Pattern-based API extraction (uses predefined API list)
- **database_loader.ts** - Advanced database loading with filtering capabilities
- **filter_engine.ts** - Extension filtering by various criteria

## Enhanced Output Format

The clustering scripts now provide comprehensive analysis in 5 sections:

### 1. Dataset Overview

- Total extensions, API calls, and unique APIs
- Source breakdown (filesystem, database, output)
- Manifest version distribution (MV2 vs MV3)
- Migration status summary

### 2. Cluster Analysis

- Clusters sorted by size with percentage distribution
- Complexity rating (simple, moderate, complex)
- Average API calls per cluster
- Manifest version breakdown per cluster
- Top APIs used in each cluster

### 3. API Domain Analysis

- Top 15 most-used API domains
- Extension count and total calls per domain
- Migration warnings for deprecated APIs
- Top 3 APIs within each domain

### 4. Migration Recommendations

- Most common deprecated APIs across dataset
- Priority extensions ranked by migration complexity
- Specific deprecated APIs used by each extension

### 5. Key Insights

- Largest cluster identification
- Complexity distribution
- Most popular APIs
- Migration priorities

## Usage Examples

```bash
# Auto-detect from .env file
npm run cluster

# Specify input directory
npm run cluster -- --input ./extensions

# Use database with custom cluster count
npm run cluster -- --database --clusters 8
```

## Architecture

```
Extensions (filesystem/database/output)
    ↓
Extension Loader (extension_loader.ts)
    ↓
API Extraction (clustering_utils.ts)
    ↓
Clustering Algorithm (clustering_utils.ts)
    ↓
Statistics Calculation (output_formatter.ts)
    ↓
Enhanced Output (output_formatter.ts)
```

## See Also

- [Enhanced Features Guide](../CLUSTERING_ENHANCED.md)
- [Quick Start Guide](../CLUSTERING_QUICK_START.md)
- [Comprehensive Guide](../README_CLUSTERING.md)
