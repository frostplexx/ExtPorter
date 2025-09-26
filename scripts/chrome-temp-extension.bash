#!/bin/bash

# Check if extension path is provided
if [ $# -eq 0 ]; then
    echo "Usage: chrome-temp-extension <extension-path>"
    echo "Example: chrome-temp-extension ~/my-extension/"
    exit 1
fi

extension_path="$(realpath "$1")"

# Check if extension path exists
if [ ! -d "$extension_path" ]; then
    echo "Error: Extension path '$extension_path' does not exist"
    exit 1
fi

# Create temporary user data directory
temp_dir=$(mktemp -d)
echo "Using temporary profile: $temp_dir"

# Launch Chrome with the extension loaded
echo "Loading extension from: $extension_path"
google-chrome-stable \
    --enable-extensions \
    --user-data-dir="$temp_dir" \
    --load-extension="$extension_path" \
    --no-first-run \
    --no-default-browser-check \
    --disable-extensions-except="$extension_path" \
    --disable-extensions-file-access-check \
    --disable-component-extensions-with-background-pages

# Clean up temporary directory after Chrome closes
echo "Chrome closed. Cleaning up temporary profile..."
rm -rf "$temp_dir"
echo "Temporary profile removed."
