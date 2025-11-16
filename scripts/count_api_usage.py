#!/usr/bin/env python3
"""
Extract and count Chrome Extension API usage across multiple extensions.

Usage:
    python count_api_usage.py <extensions_folder> [output_csv] [--mv2-only]

Arguments:
    extensions_folder: Path to folder containing unpacked extensions
    output_csv: Optional output CSV file path (default: api_usage_count.csv)
    --mv2-only: Only analyze Manifest V2 extensions
"""

import os
import sys
import re
import json
import csv
import argparse
from pathlib import Path
from collections import defaultdict
from typing import Dict, Set, Optional, List, Any

def find_js_files(extension_path: Path) -> list[Path]:
    """Recursively find all JavaScript files in an extension."""
    js_files = []
    for root, _, files in os.walk(extension_path):
        for file in files:
            if file.endswith('.js'):
                js_files.append(Path(root) / file)
    return js_files


def extract_api_calls(file_path: Path) -> Set[str]:
    """Extract chrome.* and browser.* API calls from a JavaScript file."""
    apis = set()
    
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        
        # Pattern to match chrome.api.method.submethod calls
        # Matches: chrome.tabs.query, chrome.storage.local.get, chrome.runtime.sendMessage, etc.
        # Captures the full API path (e.g., "tabs.query", "storage.local.get")
        # Using non-greedy matching and looking for method calls or property access
        pattern = r'chrome\.((?:[a-zA-Z_][a-zA-Z0-9_]*\.)*[a-zA-Z_][a-zA-Z0-9_]*)'
        matches = re.findall(pattern, content)
        apis.update(matches)
        
        # Also check for browser.* API calls (WebExtensions API)
        browser_pattern = r'browser\.((?:[a-zA-Z_][a-zA-Z0-9_]*\.)*[a-zA-Z_][a-zA-Z0-9_]*)'
        browser_matches = re.findall(browser_pattern, content)
        apis.update(browser_matches)
    
    except Exception as e:
        print(f"Error reading {file_path}: {e}", file=sys.stderr)
    
    return apis


def get_manifest(extension_path: Path) -> Optional[Dict]:
    """Load and parse manifest.json if it exists."""
    manifest_path = extension_path / 'manifest.json'
    
    if manifest_path.exists():
        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Could not parse manifest for {extension_path.name}: {e}", file=sys.stderr)
    
    return None


def get_extension_name(extension_path: Path) -> str:
    """Get extension name from manifest.json or use folder name."""
    manifest = get_manifest(extension_path)
    
    if manifest:
        name = manifest.get('name', extension_path.name)
        # Remove Chrome Web Store metadata
        if '__MSG_' in name:
            return extension_path.name
        return name
    
    return extension_path.name


def get_manifest_version(extension_path: Path) -> Optional[int]:
    """Get manifest version (2 or 3) from manifest.json."""
    manifest = get_manifest(extension_path)
    
    if manifest:
        return manifest.get('manifest_version')
    
    return None


def analyze_extensions(extensions_folder: Path, mv2_only: bool = False) -> Dict[str, Dict[str, Any]]:
    """
    Analyze all extensions in a folder and count API usage.
    
    Args:
        extensions_folder: Path to the folder containing extensions
        mv2_only: If True, only analyze Manifest V2 extensions
    
    Returns:
        Dict mapping API names to usage data (count and list of extensions)
    """
    api_usage: Dict[str, Dict[str, Any]] = defaultdict(lambda: {'count': 0, 'extensions': []})
    
    # Get all subdirectories (each is an extension)
    extension_dirs = [d for d in extensions_folder.iterdir() if d.is_dir()]
    
    print(f"Found {len(extension_dirs)} extensions to analyze...")
    if mv2_only:
        print("Filtering for Manifest V2 extensions only...")
    
    analyzed_count = 0
    skipped_count = 0
    
    for ext_dir in extension_dirs:
        # Check manifest version if filtering
        if mv2_only:
            manifest_version = get_manifest_version(ext_dir)
            if manifest_version != 2:
                skipped_count += 1
                print(f"Skipping: {ext_dir.name} (Manifest V{manifest_version or 'unknown'})")
                continue
        
        ext_name = get_extension_name(ext_dir)
        print(f"Analyzing: {ext_name}")
        analyzed_count += 1
        
        # Find all JS files in the extension
        js_files = find_js_files(ext_dir)
        
        # Extract APIs used by this extension
        extension_apis = set()
        for js_file in js_files:
            file_apis = extract_api_calls(js_file)
            extension_apis.update(file_apis)
        
        # Update usage counts
        for api in extension_apis:
            api_usage[api]['count'] += 1
            api_usage[api]['extensions'].append(ext_name)
    
    print(f"\nAnalyzed: {analyzed_count} extensions")
    if mv2_only:
        print(f"Skipped: {skipped_count} extensions (not MV2)")
    
    return api_usage


def save_to_csv(api_usage: Dict, output_path: Path):
    """Save API usage data to CSV file."""
    # Sort by count (descending)
    sorted_apis = sorted(api_usage.items(), key=lambda x: x[1]['count'], reverse=True)
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['API', 'Usage Count', 'Extensions'])
        
        for api, data in sorted_apis:
            extensions_list = '; '.join(data['extensions'])
            writer.writerow([api, data['count'], extensions_list])
    
    print(f"\nResults saved to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description='Extract and count Chrome Extension API usage across multiple extensions.'
    )
    parser.add_argument(
        'extensions_folder',
        type=str,
        help='Path to folder containing unpacked extensions'
    )
    parser.add_argument(
        'output_csv',
        type=str,
        nargs='?',
        default='api_usage_count.csv',
        help='Output CSV file path (default: api_usage_count.csv)'
    )
    parser.add_argument(
        '--mv2-only',
        action='store_true',
        help='Only analyze Manifest V2 extensions'
    )
    
    args = parser.parse_args()
    
    extensions_folder = Path(args.extensions_folder)
    output_csv = Path(args.output_csv)
    
    if not extensions_folder.exists() or not extensions_folder.is_dir():
        print(f"Error: {extensions_folder} is not a valid directory")
        sys.exit(1)
    
    print(f"Analyzing extensions in: {extensions_folder}")
    if args.mv2_only:
        print("Filter: Manifest V2 extensions only")
    print(f"Output will be saved to: {output_csv}\n")
    
    # Analyze extensions
    api_usage = analyze_extensions(extensions_folder, mv2_only=args.mv2_only)
    
    # Print summary
    print(f"\n{'='*60}")
    print(f"Analysis Complete!")
    print(f"{'='*60}")
    print(f"Total unique APIs found: {len(api_usage)}")
    print(f"\nTop 10 most used APIs:")
    sorted_apis = sorted(api_usage.items(), key=lambda x: x[1]['count'], reverse=True)
    for api, data in sorted_apis[:10]:
        print(f"  {api}: {data['count']} extensions")
    
    # Save to CSV
    save_to_csv(api_usage, output_csv)


if __name__ == '__main__':
    main()
