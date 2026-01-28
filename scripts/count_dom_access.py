#!/usr/bin/env python3

"""
Script to count extensions that interact with the DOM in their background scripts.
Usage: ./count_dom_access.py <extensions_folder> [--verbose]

Optimized for handling 100k+ extensions efficiently:
- Multiprocessing support for parallel processing
- Compiled regex patterns for performance
- Streaming results to avoid memory issues
- Progress bar with ETA
- Proper error handling for malformed files
"""

import sys
import json
import re
import argparse
from pathlib import Path
from typing import List, Optional, Tuple
from multiprocessing import Pool, cpu_count
import time

# DOM access patterns (ported from offscreen_document.ts)
DOM_PATTERNS = [
    # Document API
    r'\bdocument\.(getElementById|querySelector|querySelectorAll|createElement|createElementNS)\b',
    r'\bdocument\.(body|head|title|cookie|documentElement|forms|images|links|scripts)\b',
    r'\bdocument\.(write|writeln|open|close)\b',
    r'\bnew\s+DOMParser\(\)',
    r'\bdocument\.implementation',

    # Window API (excluding chrome.windows)
    r'(?<!chrome\.)window\.(location|history|navigator|screen|localStorage|sessionStorage)\b',
    r'(?<!chrome\.)window\.(alert|confirm|prompt)\b',
    r'(?<!chrome\.)window\.(open|close|focus|blur)\b',
    r'(?<!chrome\.)window\.(innerWidth|innerHeight|outerWidth|outerHeight|scrollX|scrollY)\b',
    r'(?<!chrome\.)window\.(getComputedStyle|matchMedia)\b',

    # DOM manipulation
    r'\.(appendChild|removeChild|replaceChild|insertBefore)\b',
    r'\.(innerHTML|outerHTML|textContent|innerText)\s*=',
    r'\.(setAttribute|getAttribute|removeAttribute|hasAttribute)\b',
    r'\.(classList|className|style)\.',
    r'\.(addEventListener|removeEventListener|dispatchEvent)\b',

    # Canvas API
    r'\bnew\s+(HTMLCanvasElement|CanvasRenderingContext2D|ImageData)\b',
    r'\.getContext\s*\(\s*[\'"`](2d|webgl|webgl2)[\'"`]\s*\)',
    r'\.(canvas|fillRect|strokeRect|fillText|strokeText|drawImage)\b',

    # Audio/Video API
    r'\bnew\s+(Audio|HTMLAudioElement|HTMLVideoElement|AudioContext|MediaSource)\b',
    r'\.play\s*\(\)',
    r'\.pause\s*\(\)',

    # Web APIs that require document context
    r'\bnew\s+(Blob|File|FileReader|Image|XMLHttpRequest)\b',
    r'\.(fetch|XMLHttpRequest|FormData|URLSearchParams)\b',
]

# Compile patterns once for performance
COMPILED_PATTERNS = [re.compile(pattern) for pattern in DOM_PATTERNS]

# Combined pattern for even faster single-pass checking
COMBINED_PATTERN = re.compile('|'.join(f'(?:{p})' for p in DOM_PATTERNS))


def contains_dom_access(file_path: Path, max_size_mb: int = 10) -> bool:
    """
    Check if a JavaScript file contains DOM access patterns.
    
    Args:
        file_path: Path to the JavaScript file
        max_size_mb: Maximum file size in MB to process
        
    Returns:
        True if DOM access patterns found, False otherwise
    """
    try:
        # Skip large files
        file_size = file_path.stat().st_size
        if file_size > max_size_mb * 1024 * 1024:
            return False

        # Read file content
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()

        # Quick check with combined pattern
        return COMBINED_PATTERN.search(content) is not None

    except Exception:
        # Silently skip files that can't be read
        return False


def extract_background_scripts(manifest_path: Path) -> List[str]:
    """
    Extract background script paths from manifest.json.
    
    Args:
        manifest_path: Path to manifest.json
        
    Returns:
        List of background script paths
    """
    try:
        # Skip large manifests (likely corrupted)
        if manifest_path.stat().st_size > 1024 * 1024:
            return []

        with open(manifest_path, 'r', encoding='utf-8', errors='ignore') as f:
            manifest = json.load(f)

        scripts = []

        # Ensure manifest is a dict
        if not isinstance(manifest, dict):
            return []

        # Only process MV2 extensions (skip MV3, Chrome Apps, and themes)
        manifest_version = manifest.get('manifest_version')
        if manifest_version != 2:
            return []

        # Skip Chrome Apps (they have "app" key)
        if 'app' in manifest:
            return []

        # Skip themes
        if 'theme' in manifest:
            return []

        # Get background configuration
        background = manifest.get('background', {})
        if not isinstance(background, dict):
            return []

        # MV2 background.scripts array
        if 'scripts' in background:
            bg_scripts = background['scripts']
            if isinstance(bg_scripts, list):
                scripts.extend([s for s in bg_scripts if isinstance(s, str)])

        # MV2 background.page
        if 'page' in background:
            page = background['page']
            if isinstance(page, str):
                scripts.append(page)

        return scripts

    except Exception:
        # Silently skip malformed manifests
        return []


def check_extension_dom_access(ext_dir: Path) -> Tuple[str, bool, bool]:
    """
    Check if an extension has DOM access in its background scripts.

    Args:
        ext_dir: Path to extension directory

    Returns:
        Tuple of (extension_name, is_mv2_extension, has_dom_access)
    """
    try:
        ext_name = ext_dir.name
        manifest_path = ext_dir / 'manifest.json'

        # Check manifest exists
        if not manifest_path.exists():
            return (ext_name, False, False)

        # Extract background scripts (returns [] for non-MV2)
        bg_scripts = extract_background_scripts(manifest_path)
        if not bg_scripts:
            # Check if it's still an MV2 extension (just without background scripts)
            try:
                with open(manifest_path, 'r', encoding='utf-8', errors='ignore') as f:
                    manifest = json.load(f)
                is_mv2 = (isinstance(manifest, dict)
                           and manifest.get('manifest_version') == 2
                           and 'app' not in manifest
                           and 'theme' not in manifest)
            except Exception:
                is_mv2 = False
            return (ext_name, is_mv2, False)

        # Check each background script
        for script in bg_scripts:
            # Skip if script is not a string
            if not isinstance(script, str):
                continue

            # Skip empty or invalid paths
            if not script or script.startswith('http://') or script.startswith('https://'):
                continue

            try:
                script_path = ext_dir / script
            except Exception:
                # Skip invalid paths
                continue

            if not script_path.exists():
                continue

            # Check .js files
            if script.endswith('.js'):
                if contains_dom_access(script_path):
                    return (ext_name, True, True)

        return (ext_name, True, False)

    except Exception:
        # Silently skip extensions that cause errors
        return (ext_dir.name if isinstance(ext_dir, Path) else str(ext_dir), False, False)


def process_extensions(extensions_dir: Path, verbose: bool = False, workers: Optional[int] = None) -> None:
    """
    Process all extensions and count those with DOM access.
    
    Args:
        extensions_dir: Directory containing extensions
        verbose: Show detailed output
        workers: Number of worker processes (default: CPU count)
    """
    # Get all extension directories
    print(f"\033[34mScanning extensions in: {extensions_dir}\033[0m")

    ext_dirs = [d for d in extensions_dir.iterdir() if d.is_dir()]
    total = len(ext_dirs)

    if total == 0:
        print("\033[33mNo extension directories found\033[0m")
        return

    print(f"\033[34mFound {total:,} extension directories\033[0m")

    # Determine number of workers
    if workers is None:
        # Cap at 32 workers to avoid overwhelming the system
        workers = min(32, max(1, cpu_count() - 1))
    else:
        # User-specified, but warn if too high
        if workers > 64:
            print(f"\033[33mWarning: {workers} workers is very high, consider using 8-32 workers\033[0m")

    print(f"\033[32mUsing {workers} worker processes\033[0m")
    print()
    print("\033[34mProcessing extensions...\033[0m")

    # Process extensions in parallel
    dom_access_extensions = []
    mv2_count = 0
    processed = 0
    errors = 0
    start_time = time.time()

    with Pool(processes=workers) as pool:
        # Use imap_unordered for better performance with large datasets
        results = pool.imap_unordered(check_extension_dom_access, ext_dirs, chunksize=100)

        try:
            for ext_name, is_mv2, has_dom_access in results:
                processed += 1

                if is_mv2:
                    mv2_count += 1

                if has_dom_access:
                    dom_access_extensions.append(ext_name)

                # Show progress
                if processed % 1000 == 0 or processed == total:
                    elapsed = time.time() - start_time
                    rate = processed / elapsed if elapsed > 0 else 0
                    eta = (total - processed) / rate if rate > 0 else 0

                    percent = (processed * 100) // total
                    print(f"\r\033[34mProgress:\033[0m {processed:,}/{total:,} ({percent}%) | "
                          f"\033[32mDOM access:\033[0m {len(dom_access_extensions):,} | "
                          f"\033[33mRate:\033[0m {rate:.0f}/s | "
                          f"\033[33mETA:\033[0m {eta:.0f}s", end='', flush=True)
        except Exception as e:
            errors += 1
            print(f"\n\033[31mError during processing: {e}\033[0m", file=sys.stderr)
            print(f"\033[33mProcessed {processed:,} extensions before error\033[0m", file=sys.stderr)
            raise

    print()  # New line after progress
    print()

    # Display results
    dom_count = len(dom_access_extensions)
    no_dom_count = mv2_count - dom_count

    print("\033[34m" + "=" * 60 + "\033[0m")
    print("\033[34mResults (MV2 extensions only)\033[0m")
    print("\033[34m" + "=" * 60 + "\033[0m")
    print()
    print(f"Total directories scanned: \033[33m{total:,}\033[0m")
    print(f"MV2 extensions found: \033[33m{mv2_count:,}\033[0m")
    print()
    print(f"MV2 with DOM access in background:    \033[32m{dom_count:,}\033[0m")
    print(f"MV2 without DOM access in background:  \033[33m{no_dom_count:,}\033[0m")

    if mv2_count > 0:
        percentage = (dom_count / mv2_count) * 100
        print(f"Percentage with DOM access: \033[32m{percentage:.2f}%\033[0m")

    elapsed_total = time.time() - start_time
    print(f"\nTotal time: \033[33m{elapsed_total:.1f}s\033[0m")
    print()

    # List extensions with DOM access if verbose
    if verbose and dom_access_extensions:
        print("\033[34mExtensions with DOM access:\033[0m")
        for ext_name in sorted(dom_access_extensions):
            print(f"  \033[32m✓\033[0m {ext_name}")
        print()

    print("\033[34m" + "=" * 60 + "\033[0m")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Count extensions that interact with the DOM in their background scripts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s /path/to/extensions
  %(prog)s /path/to/extensions --verbose
  %(prog)s /path/to/extensions --workers 8
  
Performance notes:
  - Uses multiprocessing for parallel processing
  - Default workers: CPU count - 1
  - Can process 1000+ extensions/second with multiple cores
  - Memory usage scales with worker count but stays reasonable
        """
    )

    parser.add_argument('extensions_dir', type=Path, help='Directory containing unpacked extensions')
    parser.add_argument('-v', '--verbose', action='store_true', help='Show detailed output including extension names')
    parser.add_argument('-w', '--workers', type=int, help='Number of worker processes (default: CPU count - 1)')

    args = parser.parse_args()

    # Validate directory
    if not args.extensions_dir.exists():
        print(f"\033[31mError: Directory '{args.extensions_dir}' does not exist\033[0m", file=sys.stderr)
        sys.exit(1)

    if not args.extensions_dir.is_dir():
        print(f"\033[31mError: '{args.extensions_dir}' is not a directory\033[0m", file=sys.stderr)
        sys.exit(1)

    try:
        process_extensions(args.extensions_dir, args.verbose, args.workers)
    except KeyboardInterrupt:
        print("\n\n\033[33mInterrupted by user\033[0m")
        sys.exit(130)
    except Exception as e:
        print(f"\n\033[31mError: {e}\033[0m", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
