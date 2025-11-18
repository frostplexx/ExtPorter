#!/bin/bash
# Test script to verify WS_URL environment variable is being read

echo "=== Testing default WS_URL ==="
cargo build --quiet 2>/dev/null
timeout 2 cargo run 2>&1 | head -20 | grep -E "Error|Connection" || true

echo ""
echo "=== Testing custom WS_URL ==="
WS_URL="wss://example.com:8443" timeout 2 cargo run 2>&1 | head -20 | grep -E "Error|Connection|example" || true
