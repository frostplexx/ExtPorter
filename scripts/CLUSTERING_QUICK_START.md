# Clustering Quick Start Guide

## 🚀 Quick Start (10 seconds)

```bash
# Just run the cluster command - it auto-detects everything from .env!
npm run cluster
```

That's it! The tool automatically:

- ✅ Loads extensions from `INPUT_DIR` (.env)
- ✅ Loads migrated extensions from `OUTPUT_DIR` (.env)
- ✅ Connects to MongoDB using `MONGODB_URI` (.env)
- ✅ Generates an interactive visualization

Open `cluster_visualization.html` in your browser to see the results.

## 🔧 Configuration

The tool reads from your `.env` file:

```env
INPUT_DIR=./tmp/input          # Where your MV2 extensions are
OUTPUT_DIR=./tmp/output        # Where migrated MV3 extensions are
MONGODB_URI=mongodb://...      # Your MongoDB connection
```

No configuration needed if your .env is already set up for ExtPorter!

## 📊 Common Use Cases

### Basic Usage (Auto-detect from .env)

```bash
# Just run it - uses .env configuration
npm run cluster

# With custom cluster count
npm run cluster -- --clusters 10

# With custom visualization filename
npm run cluster -- --viz ./my_analysis.html
```

### Override .env Settings

```bash
# Use different input directory
npm run cluster -- --input /path/to/other/extensions

# Only load from filesystem (ignore .env database)
npm run cluster -- --input ./extensions

# Manual paths (completely ignore .env)
npm run cluster -- --input ./ext --output ./out --clusters 8
```

### Compare Before & After Migration

```bash
# First migrate
npm run migrate

# Then cluster - automatically compares INPUT_DIR vs OUTPUT_DIR
npm run cluster
```

## 🎨 What You Get

The visualization shows:

- **3D Scatter Plot**: Visual representation of extension clusters
- **Statistics Dashboard**: Total extensions, cluster count, source breakdown
- **Cluster Cards**: Quick overview of each cluster's common APIs
- **Detailed View**: Click any cluster to see all extensions and their API usage

## 🔍 Understanding Clusters

Each cluster groups extensions that use similar Chrome APIs. For example:

- **Cluster 0**: Extensions using `chrome.tabs`, `chrome.storage`, `chrome.runtime`
    - Usually: Content manipulators, tab managers
- **Cluster 1**: Extensions using `chrome.webRequest`, `chrome.declarativeNetRequest`
    - Usually: Ad blockers, privacy tools
- **Cluster 2**: Extensions using `chrome.contextMenus`, `chrome.notifications`
    - Usually: Productivity tools, context menu enhancers

## 📈 Interpreting the 3D Plot

- **X-axis (Total API Calls)**: How heavily the extension uses Chrome APIs
- **Y-axis (Unique APIs)**: How many different APIs the extension uses
- **Z-axis (Manifest Version)**: MV2 (2) or MV3 (3)
- **Colors**: Each cluster has a unique color

## 💡 Pro Tips

1. **Start with fewer clusters** (3-5) for small datasets
2. **Use more clusters** (10-20) for large, diverse datasets
3. **Compare sources** to see how migration changed API usage
4. **Look for outliers** - extensions far from their cluster might need special attention

## 🔧 Customization

Change output file:

```bash
npm run cluster -- --input ./extensions --viz ./my_analysis.html
```

Adjust cluster count:

```bash
npm run cluster -- --input ./extensions --clusters 15
```

## 📚 Learn More

- Full documentation: [README_CLUSTERING.md](README_CLUSTERING.md)
- Example scripts: Run `./example_cluster_usage.sh`
- Main README: [../README.md](../README.md)

## ❓ Troubleshooting

**"No extensions loaded"**

- Check that your path exists
- Make sure extensions have manifest.json files

**"Could not load from database"**

- Run `npm run db:up` to start MongoDB
- Check `.env` file for correct database settings

**Visualization doesn't open**

- Open `cluster_visualization.html` manually in your browser
- Make sure you have a modern browser (Chrome, Firefox, Safari, Edge)
