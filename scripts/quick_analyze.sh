#!/bin/bash
# Quick optimization script for massive heap snapshot analysis
# Run this to stop current process and restart with better settings

echo "🛑 Optimizing heap analyzer for 590GB dataset..."

# Kill any existing heap analyzer processes
echo "Stopping existing processes..."
pkill -f "heap_analyzer_optimized.py" 2>/dev/null || true

echo "🚀 Starting optimized analysis for large dataset..."
echo "   Recommended settings for 590GB (398 files):"
echo "   - 16 workers (optimal for most systems)"
echo "   - 10% sampling for initial quick analysis"
echo "   - Increased memory limit"

# Start with aggressive optimizations
python3 ./scripts/heap_analyzer_optimized.py ./logs/ \
    --workers 16 \
    --sample-rate 0.1 \
    --memory-limit 32.0 \
    --streaming-threshold 50

echo ""
echo "💡 This will analyze 10% of nodes for ~20x speed improvement"
echo "   If you need full accuracy later, run without --sample-rate 0.1"