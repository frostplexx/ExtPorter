# Extension API Clustering Tool

A powerful tool to analyze and cluster Chrome extensions based on their API usage patterns. This helps identify groups of extensions with similar functionality and compare MV2 vs MV3 API changes.

## Features

- 🔍 **API Extraction**: Automatically extracts Chrome API usage from JavaScript files
- 📊 **K-means Clustering**: Groups extensions by API similarity using machine learning
- 🎨 **Interactive Visualization**: Beautiful 3D scatter plot and cluster browser
- 🔄 **Multi-source Support**: Load extensions from filesystem, database, or output directories
- 📈 **Comparison Mode**: Compare MV2 vs MV3 API changes side-by-side

## Installation

The required dependencies are already installed:

- `ml-kmeans`: K-means clustering algorithm
- `plotly.js`: Interactive 3D visualizations
- `chalk`: Terminal colors

## Usage

### Basic Usage

Cluster extensions from a directory:

```bash
npm run cluster -- --input ./extensions
```

### Compare MV2 vs MV3

Compare original extensions with migrated versions:

```bash
npm run cluster -- --input ./extensions --output ./tmp/output
```

### Include Database Extensions

Load extensions from MongoDB and cluster them:

```bash
npm run cluster -- --database --input ./extensions
```

### Custom Options

```bash
npm run cluster -- \
  --input ./extensions \
  --output ./tmp/output \
  --database \
  --clusters 10 \
  --viz ./my_clusters.html
```

## Command Line Options

| Option             | Short | Description                                  | Default                        |
| ------------------ | ----- | -------------------------------------------- | ------------------------------ |
| `--input <path>`   | `-i`  | Path to input extensions directory           | -                              |
| `--output <path>`  | `-o`  | Path to migrated extensions output directory | -                              |
| `--database`       | `-d`  | Load extensions from MongoDB database        | false                          |
| `--clusters <num>` | `-c`  | Number of clusters to create                 | 5                              |
| `--viz <file>`     | `-v`  | Output HTML file for visualization           | `./cluster_visualization.html` |
| `--help`           | `-h`  | Show help message                            | -                              |

## Examples

### Example 1: Analyze Test Extensions

```bash
npm run cluster -- --input ./tests/fixtures/mock-extensions --clusters 3
```

Output:

```
🔬 Extension API Clustering Tool

Loading extensions from ./tests/fixtures/mock-extensions...
✓ Loaded 6 extensions from filesystem
Clustering 6 extensions into 3 groups...
✓ Clustering complete

📊 Clustering Summary:

Cluster 0:
  Extensions: 4
  Common APIs: chrome.runtime, chrome.browserAction, chrome.tabs

Cluster 1:
  Extensions: 1
  Common APIs: chrome.storage, chrome.tabs, chrome.windows

Cluster 2:
  Extensions: 1
  Common APIs: chrome.runtime, chrome.storage, chrome.contextMenus
```

### Example 2: Compare Migration Results

```bash
# First, migrate some extensions
npm run migrate

# Then cluster both input and output
npm run cluster -- --input ./extensions --output ./tmp/output --clusters 8
```

This will show you:

- Which extensions use similar APIs
- How API usage changed from MV2 to MV3
- Clusters with both MV2 and MV3 versions

### Example 3: Analyze Large Dataset

```bash
npm run cluster -- \
  --input /path/to/large/extension/dataset \
  --clusters 20 \
  --viz ./analysis_results.html
```

## Understanding the Visualization

The generated HTML file contains:

### 1. Statistics Dashboard

- Total extensions analyzed
- Number of clusters
- Source breakdown (filesystem/database/output)
- Manifest version distribution

### 2. 3D Scatter Plot

- **X-axis**: Total API calls
- **Y-axis**: Number of unique APIs used
- **Z-axis**: Manifest version (2 or 3)
- **Colors**: Each cluster has a unique color
- **Hover**: Shows extension name, API count, and source

### 3. Cluster Cards

Each cluster shows:

- Number of extensions
- Common APIs (used by 50%+ of extensions)
- Click to see detailed extension list

### 4. Cluster Details Modal

Click any cluster to see:

- Full list of extensions in the cluster
- Top 10 APIs used by each extension
- Source and manifest version badges

## Tracked Chrome APIs

The tool tracks 30+ Chrome API namespaces including:

**Core APIs:**

- `chrome.runtime`, `chrome.storage`, `chrome.tabs`, `chrome.windows`

**UI APIs:**

- `chrome.action`, `chrome.browserAction`, `chrome.pageAction`
- `chrome.contextMenus`, `chrome.notifications`, `chrome.omnibox`

**Content APIs:**

- `chrome.scripting`, `chrome.cookies`, `chrome.downloads`
- `chrome.history`, `chrome.bookmarks`

**Network APIs:**

- `chrome.webRequest`, `chrome.webNavigation`
- `chrome.declarativeNetRequest`, `chrome.proxy`

**Advanced APIs:**

- `chrome.alarms`, `chrome.identity`, `chrome.management`
- `chrome.permissions`, `chrome.privacy`, `chrome.offscreen`

And more! See `CHROME_API_PATTERNS` in the script for the complete list.

## How Clustering Works

1. **API Extraction**: Scans all JavaScript files for Chrome API usage
2. **Vectorization**: Converts API counts to feature vectors using log scale
3. **Normalization**: Normalizes vectors using L2 normalization
4. **K-means**: Groups extensions with similar API patterns
5. **Analysis**: Identifies common APIs in each cluster

### Why Log Scale?

We use logarithmic scaling (`log(count + 1)`) because:

- Extensions that call an API 1000 times aren't necessarily 1000x different from those calling it 10 times
- Log scale gives better clustering by focusing on API presence/absence and moderate usage

### Why L2 Normalization?

L2 normalization ensures:

- Extensions with many API calls don't dominate the clustering
- Focus is on API usage _patterns_, not absolute counts
- Better separation between clusters

## Output Files

### cluster_visualization.html

A self-contained HTML file with:

- No external dependencies (except Plotly.js from CDN)
- Dark theme optimized for long viewing sessions
- Responsive design works on mobile
- Interactive 3D visualization
- Searchable cluster details

## Use Cases

### 1. Dataset Analysis

Understand the composition of your extension dataset:

- What types of extensions do you have?
- Which APIs are most common?
- Are there outliers?

### 2. Migration Validation

Compare MV2 and MV3 versions:

- Did API usage change as expected?
- Are there unexpected API additions?
- Which extensions had the most changes?

### 3. Testing Strategy

Identify representative extensions:

- Pick one extension from each cluster for testing
- Ensures test coverage across different API patterns
- Reduces redundant testing

### 4. Research & Documentation

Generate insights for papers or documentation:

- API usage statistics
- Common extension patterns
- Migration trends

## Troubleshooting

### "No extensions loaded"

- Check that the input path exists and contains extensions
- Ensure extensions have `manifest.json` files
- Try with `--help` to see usage

### "Adjusting cluster count"

- The script automatically reduces clusters if you have fewer extensions
- This is normal and ensures meaningful clustering

### "Could not load from database"

- Ensure MongoDB is running: `npm run db:up`
- Check that `.env` has correct `MONGODB_URI`
- Verify extensions were saved to database

### Large files cause errors

- Extensions with very large files (>100KB) might fail to parse
- These are automatically skipped
- Check console output for warnings

## Performance Tips

- **Large datasets**: Use `--clusters 10-20` for better separation
- **Small datasets**: Use `--clusters 3-5` to avoid overfitting
- **Database mode**: Slower but includes historical data
- **Filesystem only**: Fastest for quick analysis

## Technical Details

### Algorithm: K-means++

We use K-means++ initialization which:

- Spreads initial centroids across the data
- Converges faster than random initialization
- Produces more stable results

### Distance Metric: Euclidean

Extensions are grouped by Euclidean distance in API feature space. Closer distance = more similar API usage.

### Convergence

The algorithm stops when:

- Centroids move less than tolerance threshold (1e-6)
- Maximum iterations reached (100)

## Contributing

To add new Chrome APIs to track:

1. Edit `CHROME_API_PATTERNS` in `cluster_extensions.ts`
2. Add the API pattern (e.g., `'chrome.newAPI'`)
3. Re-run clustering to include new API

## License

Same as the main project (ISC).
