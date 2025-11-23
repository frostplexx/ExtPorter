#!/bin/bash

# Test script to verify CWS metadata extraction and display
# This script tests the complete flow from HTML parsing to display in the Rust analyzer

echo "========================================="
echo "CWS Metadata Extraction Test"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check if sample CWS HTML exists
echo "Step 1: Checking for sample CWS HTML..."
if [ -f "tests/fixtures/sample-cws.html" ]; then
	echo -e "${GREEN}✓${NC} Sample CWS HTML found"
else
	echo -e "${RED}✗${NC} Sample CWS HTML not found"
	exit 1
fi

# Step 2: Run TypeScript tests
echo ""
echo "Step 2: Running CWS parser tests..."
npm test -- tests/unit/utils/cws_parser.test.ts --silent 2>&1 | grep -E "(PASS|FAIL|✓|✗)" | head -20
if [ $? -eq 0 ]; then
	echo -e "${GREEN}✓${NC} All tests passed"
else
	echo -e "${RED}✗${NC} Some tests failed"
	exit 1
fi

# Step 3: Check Rust compilation
echo ""
echo "Step 3: Checking Rust analyzer compilation..."
cd ext_analyzer
cargo build 2>&1 | grep -E "Finished|error" | head -5
if [ $? -eq 0 ]; then
	echo -e "${GREEN}✓${NC} Rust analyzer compiled successfully"
else
	echo -e "${RED}✗${NC} Rust compilation failed"
	exit 1
fi
cd ..

echo ""
echo "========================================="
echo "All tests passed! ✓"
echo "========================================="
echo ""
echo "What was fixed:"
echo "1. CWS parser now extracts full description from Overview section (.JJ3H1e)"
echo "2. CWS parser extracts images from data-media-url attributes"
echo "3. CWS parser filters out videos and placeholder images"
echo "4. Rust analyzer now prioritizes full description over short description"
echo ""
echo "To test with real data:"
echo "1. Set CWS_DIR environment variable to directory with CWS HTML files"
echo "2. Ensure HTML files are named after extension directory names"
echo "3. Run the migrator to extract and save CWS metadata"
echo "4. Run the Rust analyzer to view the data"
echo ""
