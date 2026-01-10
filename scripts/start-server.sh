#!/bin/bash
# Bootstrap script that automatically sets Node.js memory limits based on available system RAM

set -e

# Get total system memory in KB
if [[ -f /proc/meminfo ]]; then
    # Linux
    TOTAL_MEM_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
elif command -v sysctl &> /dev/null; then
    # macOS
    TOTAL_MEM_KB=$(($(sysctl -n hw.memsize) / 1024))
else
    echo "Warning: Could not detect system memory, using default 8GB limit"
    TOTAL_MEM_KB=8388608
fi

# Convert to MB
TOTAL_MEM_MB=$((TOTAL_MEM_KB / 1024))

# Use 80% of total RAM for Node.js heap, leave 20% for OS and other processes
# Cap at a reasonable maximum to avoid GC issues (1TB max)
HEAP_SIZE_MB=$((TOTAL_MEM_MB * 80 / 100))
MAX_HEAP_MB=1048576  # 1TB max

if [[ $HEAP_SIZE_MB -gt $MAX_HEAP_MB ]]; then
    HEAP_SIZE_MB=$MAX_HEAP_MB
fi

# Minimum 4GB
MIN_HEAP_MB=4096
if [[ $HEAP_SIZE_MB -lt $MIN_HEAP_MB ]]; then
    HEAP_SIZE_MB=$MIN_HEAP_MB
fi

echo "System RAM: ${TOTAL_MEM_MB}MB"
echo "Setting Node.js max heap to: ${HEAP_SIZE_MB}MB (80% of available RAM)"

# Build NODE_OPTIONS, preserving any existing options
MEMORY_OPTS="--max-old-space-size=${HEAP_SIZE_MB} --max-semi-space-size=512 --expose-gc"

if [[ -n "$NODE_OPTIONS" ]]; then
    # Remove any existing max-old-space-size from NODE_OPTIONS to avoid conflicts
    EXISTING_OPTS=$(echo "$NODE_OPTIONS" | sed 's/--max-old-space-size=[0-9]*//g' | sed 's/--max-semi-space-size=[0-9]*//g' | sed 's/--expose-gc//g' | xargs)
    export NODE_OPTIONS="${MEMORY_OPTS} ${EXISTING_OPTS}"
else
    export NODE_OPTIONS="${MEMORY_OPTS}"
fi

echo "NODE_OPTIONS: $NODE_OPTIONS"

# Run the server
exec yarn server "$@"
