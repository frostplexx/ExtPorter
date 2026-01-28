#!/usr/bin/env python3

"""
Script to count MV2 extensions that interact with the DOM in their background scripts.
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

# Combined pattern for fast single-pass checking
COMBINED_PATTERN = re.compile('|'.join(f'(?:{p})' for p in DOM_PATTERNS))

# Pattern to extract <script src="..."> from HTML background pages
SCRIPT_SRC_PATTERN = re.compile(r'<script[^>]+src\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)

# Pattern to extract inline <script>...</script> content
INLINE_SCRIPT_PATTERN = re.compile(r'<script(?:\s[^>]*)?>(.+?)</script>', re.IGNORECASE | re.DOTALL)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def content_has_dom_access(content: str) -> bool:
    """Check if text content contains DOM access patterns."""
    return COMBINED_PATTERN.search(content) is not None


def file_has_dom_access(file_path: Path) -> bool:
    """Check if a file contains DOM access patterns."""
    try:
        if file_path.stat().st_size > MAX_FILE_SIZE:
            return False
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            return content_has_dom_access(f.read())
    except Exception:
        return False


def check_background_page(ext_dir: Path, page_path: str) -> bool:
    """
    Check a background HTML page and all scripts it references for DOM access.
    """
    try:
        html_file = ext_dir / page_path
        if not html_file.exists() or html_file.stat().st_size > MAX_FILE_SIZE:
            return False

        with open(html_file, 'r', encoding='utf-8', errors='ignore') as f:
            html_content = f.read()

        # Check inline scripts
        for match in INLINE_SCRIPT_PATTERN.finditer(html_content):
            if content_has_dom_access(match.group(1)):
                return True

        # Check referenced script files
        page_dir = html_file.parent
        for match in SCRIPT_SRC_PATTERN.finditer(html_content):
            src = match.group(1)
            if src.startswith('http://') or src.startswith('https://'):
                continue
            try:
                script_path = page_dir / src
                if script_path.exists() and file_has_dom_access(script_path):
                    return True
            except Exception:
                continue

        return False
    except Exception:
        return False


def check_extension_dom_access(ext_dir: Path) -> Tuple[str, bool, bool]:
    """
    Check if an MV2 extension has DOM access in its background scripts.

    Returns:
        Tuple of (extension_name, is_mv2_extension, has_dom_access)
    """
    try:
        ext_name = ext_dir.name
        manifest_path = ext_dir / 'manifest.json'

        if not manifest_path.exists():
            return (ext_name, False, False)

        # Skip large manifests (likely corrupted)
        if manifest_path.stat().st_size > 1024 * 1024:
            return (ext_name, False, False)

        try:
            with open(manifest_path, 'r', encoding='utf-8', errors='ignore') as f:
                manifest = json.load(f)
        except Exception:
            return (ext_name, False, False)

        if not isinstance(manifest, dict):
            return (ext_name, False, False)

        # Only MV2 extensions (skip MV3, Chrome Apps, themes)
        if manifest.get('manifest_version') != 2:
            return (ext_name, False, False)
        if 'app' in manifest:
            return (ext_name, False, False)
        if 'theme' in manifest:
            return (ext_name, False, False)

        # It's a valid MV2 extension
        background = manifest.get('background', {})
        if not isinstance(background, dict):
            return (ext_name, True, False)

        # Check background.scripts (JS files listed in manifest)
        if 'scripts' in background:
            bg_scripts = background['scripts']
            if isinstance(bg_scripts, list):
                for script in bg_scripts:
                    if not isinstance(script, str) or not script:
                        continue
                    if script.startswith('http://') or script.startswith('https://'):
                        continue
                    try:
                        script_path = ext_dir / script
                        if script_path.exists() and file_has_dom_access(script_path):
                            return (ext_name, True, True)
                    except Exception:
                        continue

        # Check background.page (HTML file that may contain inline/referenced scripts)
        if 'page' in background:
            page = background['page']
            if isinstance(page, str) and page:
                if check_background_page(ext_dir, page):
                    return (ext_name, True, True)

        return (ext_name, True, False)

    except Exception:
        return (ext_dir.name if isinstance(ext_dir, Path) else str(ext_dir), False, False)


def process_extensions(extensions_dir: Path, verbose: bool = False, workers: Optional[int] = None) -> None:
    """
    Process all extensions and count those with DOM access.
    """
    print(f"\033[34mScanning extensions in: {extensions_dir}\033[0m")

    ext_dirs = [d for d in extensions_dir.iterdir() if d.is_dir()]
    total = len(ext_dirs)

    if total == 0:
        print("\033[33mNo extension directories found\033[0m")
        return

    print(f"\033[34mFound {total:,} extension directories\033[0m")

    if workers is None:
        workers = min(32, max(1, cpu_count() - 1))
    elif workers > 64:
        print(f"\033[33mWarning: {workers} workers is very high, consider using 8-32 workers\033[0m")

    print(f"\033[32mUsing {workers} worker processes\033[0m")
    print()
    print("\033[34mProcessing extensions...\033[0m")

    dom_access_extensions = []
    mv2_count = 0
    processed = 0
    start_time = time.time()

    with Pool(processes=workers) as pool:
        results = pool.imap_unordered(check_extension_dom_access, ext_dirs, chunksize=100)

        try:
            for ext_name, is_mv2, has_dom_access in results:
                processed += 1

                if is_mv2:
                    mv2_count += 1

                if has_dom_access:
                    dom_access_extensions.append(ext_name)

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
            print(f"\n\033[31mError during processing: {e}\033[0m", file=sys.stderr)
            print(f"\033[33mProcessed {processed:,} extensions before error\033[0m", file=sys.stderr)
            raise

    print()
    print()

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

    if verbose and dom_access_extensions:
        print("\033[34mExtensions with DOM access:\033[0m")
        for ext_name in sorted(dom_access_extensions):
            print(f"  \033[32m✓\033[0m {ext_name}")
        print()

    print("\033[34m" + "=" * 60 + "\033[0m")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Count MV2 extensions that interact with the DOM in their background scripts',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s /path/to/extensions
  %(prog)s /path/to/extensions --verbose
  %(prog)s /path/to/extensions --workers 8
        """
    )

    parser.add_argument('extensions_dir', type=Path, help='Directory containing unpacked extensions')
    parser.add_argument('-v', '--verbose', action='store_true', help='Show detailed output including extension names')
    parser.add_argument('-w', '--workers', type=int, help='Number of worker processes (default: CPU count - 1)')

    args = parser.parse_args()

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
