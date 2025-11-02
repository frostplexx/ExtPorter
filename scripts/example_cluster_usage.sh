#!/bin/bash

# Example usage scripts for the Extension API Clustering Tool
# Run these examples to see the clustering tool in action

echo "=========================================="
echo "Extension API Clustering - Usage Examples"
echo "=========================================="
echo ""

# Example 1: Basic clustering of test extensions
echo "Example 1: Cluster test extensions"
echo "Command: npm run cluster -- --input ./tests/fixtures/mock-extensions --clusters 3"
echo ""
npm run cluster -- --input ./tests/fixtures/mock-extensions --clusters 3
echo ""
echo "✓ Visualization saved to cluster_visualization.html"
echo ""

# Example 2: Cluster with more groups
echo "=========================================="
echo "Example 2: Cluster with 5 groups"
echo "Command: npm run cluster -- --input ./tests/fixtures/mock-extensions --clusters 5 --viz ./clusters_5.html"
echo ""
npm run cluster -- --input ./tests/fixtures/mock-extensions --clusters 5 --viz ./clusters_5.html
echo ""
echo "✓ Visualization saved to clusters_5.html"
echo ""

# Example 3: Show help
echo "=========================================="
echo "Example 3: Show all available options"
echo "Command: npm run cluster -- --help"
echo ""
npm run cluster -- --help
echo ""

echo "=========================================="
echo "Examples complete!"
echo ""
echo "Open the generated HTML files in your browser to view the visualizations:"
echo "  - cluster_visualization.html"
echo "  - clusters_5.html"
echo ""
echo "To use with real extensions:"
echo "  npm run cluster -- --input /path/to/extensions --clusters 10"
echo ""
echo "To compare MV2 vs MV3 (after migration):"
echo "  npm run cluster -- --input ./extensions --output ./tmp/output"
echo ""
echo "To include database extensions:"
echo "  npm run cluster -- --database --input ./extensions"
echo "=========================================="
