#!/usr/bin/env python3
import os
import sys
import subprocess
import json
import csv
from pathlib import Path
from typing import Dict, List, Tuple

# ===== CONFIGURATION =====
# Adjust these weights to change scoring priorities
WEIGHTS = {
    'webRequest': 25,           # +25 per webRequest occurrence
    'html_lines': 0.25,         # +0.25 per line of HTML
    'storage_local': 5,         # +5 per storage.local occurrence
    'background_page': 10,      # +10 if has background page/service worker
    'content_scripts': 4,       # +4 if has content scripts
    'dangerous_permissions': 8, # +8 per dangerous permission (tabs, cookies, history, etc.)
    'host_permissions': 3,      # +3 per external host permission
    'crypto_patterns': 15,      # +15 per crypto/obfuscation pattern (eval, Function, btoa, etc.)
    'network_requests': 2,      # +2 per network request pattern (fetch, XMLHttpRequest, etc.)
    'extension_size': 1,        # +1 per 100KB of extension size
}
# ========================

def run_ripgrep(pattern: str, directory: str, count_only: bool = True) -> int:
    """Run ripgrep to count matches for a pattern in a directory."""
    try:
        cmd = ['rg', '-c' if count_only else '', pattern, directory]
        if count_only:
            cmd = ['rg', '-c', pattern, directory]
        else:
            cmd = ['rg', pattern, directory]

        result = subprocess.run(cmd, capture_output=True, text=True, check=False)

        if count_only:
            # Sum up all the counts from different files
            total = 0
            for line in result.stdout.strip().split('\n'):
                if line and ':' in line:
                    count = int(line.split(':')[-1])
                    total += count
            return total
        else:
            return len(result.stdout.strip().split('\n')) if result.stdout.strip() else 0
    except Exception as e:
        print(f"Error running ripgrep: {e}")
        return 0

def count_html_lines(directory: str) -> int:
    """Count total lines in HTML files."""
    try:
        result = subprocess.run(
            ['find', directory, '-name', '*.html', '-exec', 'wc', '-l', '{}', '+'],
            capture_output=True, text=True, check=False
        )

        total_lines = 0
        for line in result.stdout.strip().split('\n'):
            if line.strip() and not line.strip().endswith('total'):
                parts = line.strip().split()
                if parts and parts[0].isdigit():
                    total_lines += int(parts[0])
        return total_lines
    except Exception as e:
        print(f"Error counting HTML lines: {e}")
        return 0

def has_background_page(directory: str) -> bool:
    """Check if extension has a background page by looking at manifest."""
    manifest_path = os.path.join(directory, 'manifest.json')
    if not os.path.exists(manifest_path):
        return False

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)

        # Check for background scripts/pages in manifest v2 and v3
        if 'background' in manifest:
            return True
        if 'service_worker' in manifest:
            return True

        return False
    except Exception as e:
        print(f"Error reading manifest in {directory}: {e}")
        return False

def has_content_scripts(directory: str) -> bool:
    """Check if extension has content scripts by looking at manifest."""
    manifest_path = os.path.join(directory, 'manifest.json')
    if not os.path.exists(manifest_path):
        return False

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)

        return 'content_scripts' in manifest and len(manifest['content_scripts']) > 0
    except Exception as e:
        print(f"Error reading manifest in {directory}: {e}")
        return False

def get_dangerous_permissions(directory: str) -> int:
    """Count dangerous permissions in manifest."""
    manifest_path = os.path.join(directory, 'manifest.json')
    if not os.path.exists(manifest_path):
        return 0

    dangerous_perms = ['tabs', 'activeTab', 'cookies', 'history', 'bookmarks', 'management', 'privacy', 'proxy', 'downloads', 'nativeMessaging']

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)

        count = 0
        permissions = manifest.get('permissions', [])
        for perm in permissions:
            if perm in dangerous_perms:
                count += 1

        return count
    except Exception as e:
        print(f"Error reading permissions in {directory}: {e}")
        return 0

def get_host_permissions_count(directory: str) -> int:
    """Count external host permissions."""
    manifest_path = os.path.join(directory, 'manifest.json')
    if not os.path.exists(manifest_path):
        return 0

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            manifest = json.load(f)

        count = 0
        # Manifest v2
        permissions = manifest.get('permissions', [])
        for perm in permissions:
            if isinstance(perm, str) and ('://' in perm or perm.startswith('*')):
                count += 1

        # Manifest v3
        host_permissions = manifest.get('host_permissions', [])
        count += len(host_permissions)

        return count
    except Exception as e:
        print(f"Error reading host permissions in {directory}: {e}")
        return 0

def get_extension_size(directory: str) -> int:
    """Get extension size in KB."""
    try:
        result = subprocess.run(['du', '-sk', directory], capture_output=True, text=True, check=False)
        if result.returncode == 0:
            return int(result.stdout.split()[0])
        return 0
    except Exception:
        return 0

def calculate_interestingness_score(extension_dir: str) -> Tuple[int, Dict[str, int]]:
    """Calculate interestingness score for an extension with configurable weights."""
    scores = {
        'webRequest': 0,
        'html_lines': 0,
        'storage_local': 0,
        'background_page': 0,
        'content_scripts': 0,
        'dangerous_permissions': 0,
        'host_permissions': 0,
        'crypto_patterns': 0,
        'network_requests': 0,
        'extension_size': 0
    }

    # webRequest occurrences
    webRequest_count = run_ripgrep(r'webRequest', extension_dir)
    scores['webRequest'] = int(webRequest_count * WEIGHTS['webRequest'])

    # HTML lines
    html_lines = count_html_lines(extension_dir)
    scores['html_lines'] = int(html_lines * WEIGHTS['html_lines'])

    # storage.local occurrences
    storage_local_count = run_ripgrep(r'storage\.local', extension_dir)
    scores['storage_local'] = int(storage_local_count * WEIGHTS['storage_local'])

    # Background page/service worker
    if has_background_page(extension_dir):
        scores['background_page'] = int(WEIGHTS['background_page'])

    # Content scripts
    if has_content_scripts(extension_dir):
        scores['content_scripts'] = int(WEIGHTS['content_scripts'])

    # Dangerous permissions
    dangerous_perms_count = get_dangerous_permissions(extension_dir)
    scores['dangerous_permissions'] = int(dangerous_perms_count * WEIGHTS['dangerous_permissions'])

    # Host permissions
    host_perms_count = get_host_permissions_count(extension_dir)
    scores['host_permissions'] = int(host_perms_count * WEIGHTS['host_permissions'])

    # Crypto/obfuscation patterns
    crypto_patterns = ['eval\\(', 'Function\\(', 'btoa\\(', 'atob\\(', 'crypto\\.']
    crypto_count = sum(run_ripgrep(pattern, extension_dir) for pattern in crypto_patterns)
    scores['crypto_patterns'] = int(crypto_count * WEIGHTS['crypto_patterns'])

    # Network request patterns
    network_patterns = ['fetch\\(', 'XMLHttpRequest', '\\.ajax\\(']
    network_count = sum(run_ripgrep(pattern, extension_dir) for pattern in network_patterns)
    scores['network_requests'] = int(network_count * WEIGHTS['network_requests'])

    # Extension size (bonus for larger extensions)
    size_kb = get_extension_size(extension_dir)
    scores['extension_size'] = int((size_kb / 100) * WEIGHTS['extension_size'])  # Score per 100KB

    total_score = sum(scores.values())
    return total_score, scores

def analyze_extensions(extensions_folder: str, output_file: str):
    """Analyze all extensions in a folder and output results."""
    if not os.path.exists(extensions_folder):
        print(f"Error: Extensions folder '{extensions_folder}' does not exist.")
        return

    results = []

    # Get all subdirectories (each representing an extension)
    extension_dirs = [d for d in os.listdir(extensions_folder)
                     if os.path.isdir(os.path.join(extensions_folder, d))]

    print(f"Analyzing {len(extension_dirs)} extensions...")

    for ext_dir in extension_dirs:
        full_path = os.path.join(extensions_folder, ext_dir)
        print(f"Analyzing: {ext_dir}")

        total_score, score_breakdown = calculate_interestingness_score(full_path)

        results.append({
            'extension': ext_dir,
            'total_score': total_score,
            'breakdown': score_breakdown
        })

    # Sort by total score (highest first)
    results.sort(key=lambda x: x['total_score'], reverse=True)

    # Write results to CSV file
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        fieldnames = ['extension', 'total_score', 'webRequest', 'html_lines', 'storage_local',
                     'background_page', 'content_scripts', 'dangerous_permissions',
                     'host_permissions', 'crypto_patterns', 'network_requests', 'extension_size']
        writer = csv.DictWriter(f, fieldnames=fieldnames)

        writer.writeheader()

        for result in results:
            row = {
                'extension': result['extension'],
                'total_score': result['total_score'],
                **result['breakdown']
            }
            writer.writerow(row)

    print(f"\nAnalysis complete! Results written to: {output_file}")
    print(f"Top 3 most interesting extensions:")
    for i, result in enumerate(results[:3], 1):
        print(f"{i}. {result['extension']} (score: {result['total_score']})")

def main():
    if len(sys.argv) != 3:
        print("Usage: python extension_analyzer.py <extensions_folder> <output_file>")
        print("Example: python extension_analyzer.py ./extensions analysis_results.csv")
        sys.exit(1)

    extensions_folder = sys.argv[1]
    output_file = sys.argv[2]

    analyze_extensions(extensions_folder, output_file)

if __name__ == "__main__":
    main()