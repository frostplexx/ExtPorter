#!/usr/bin/env python3

"""
Script to count MV2 extensions that interact with the DOM in their background scripts.
Only counts extensions that would genuinely need an offscreen document after migration to MV3.

Usage: ./count_dom_access.py <extensions_folder> [--verbose]

Strictness measures:
- Comments (// and /* */) and string literals are stripped before pattern matching
- Only patterns that truly require a document/DOM context are checked
  (APIs available in service workers like fetch, Blob, FileReader etc. are excluded)
- Generic methods like .play(), .addEventListener() are excluded (they exist on non-DOM objects)
"""

import sys
import json
import re
import argparse
from pathlib import Path
from typing import Optional, Tuple
from multiprocessing import Pool, cpu_count
import time

# ── Comment and string stripping ─────────────────────────────────────────────
# Order matters: match strings first so we don't treat quotes inside comments
# as string boundaries and vice versa.
_STRIP_RE = re.compile(
    r'//[^\n]*'            # single-line comment
    r'|/\*[\s\S]*?\*/'    # multi-line comment
    r'|`(?:[^`\\]|\\.)*`' # template literal
    r"|'(?:[^'\\]|\\.)*'" # single-quoted string
    r'|"(?:[^"\\]|\\.)*"' # double-quoted string
)


def strip_comments_and_strings(code: str) -> str:
    """Remove comments and string literals so we only match actual code."""
    return _STRIP_RE.sub(' ', code)


# ── DOM patterns that DEFINITELY need a document context ─────────────────────
# These would all fail in a MV3 service worker and require an offscreen document.
# Intentionally conservative – if in doubt, leave it out.
DOM_PATTERNS = [


    # ── window.* APIs that do NOT exist in service workers ───────────────────
    # (excluding navigator/location/screen which are available via self.*)
    r'(?<!chrome\.)window\.(alert|confirm|prompt)\s*\(',
    r'(?<!chrome\.)window\.(getComputedStyle|matchMedia)\s*\(',
    r'(?<!chrome\.)window\.(innerWidth|innerHeight|outerWidth|outerHeight|scrollX|scrollY|pageXOffset|pageYOffset)\b',
    r'(?<!chrome\.)window\.(localStorage|sessionStorage)\b',
    r'(?<!chrome\.)window\.history\b',
    r'(?<!chrome\.)extension\.getBackgroundPage\b',

]

COMBINED_PATTERN = re.compile('|'.join(f'(?:{p})' for p in DOM_PATTERNS))

# HTML parsing for background pages
SCRIPT_SRC_PATTERN = re.compile(r'<script[^>]+src\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
INLINE_SCRIPT_PATTERN = re.compile(r'<script(?:\s[^>]*)?>(.+?)</script>', re.IGNORECASE | re.DOTALL)

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


def code_has_dom_access(code: str) -> bool:
    """Check if code (with comments/strings already stripped) has DOM patterns."""
    return COMBINED_PATTERN.search(code) is not None


def file_has_dom_access(file_path: Path) -> bool:
    """Read a JS file, strip comments/strings, and check for DOM patterns."""
    try:
        if file_path.stat().st_size > MAX_FILE_SIZE:
            return False
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
        return code_has_dom_access(strip_comments_and_strings(content))
    except Exception:
        return False


def check_background_page(ext_dir: Path, page_path: str) -> bool:
    """Check a background HTML page and all scripts it references."""
    try:
        html_file = ext_dir / page_path
        if not html_file.exists() or html_file.stat().st_size > MAX_FILE_SIZE:
            return False

        with open(html_file, 'r', encoding='utf-8', errors='ignore') as f:
            html_content = f.read()

        # Check inline scripts
        for match in INLINE_SCRIPT_PATTERN.finditer(html_content):
            code = strip_comments_and_strings(match.group(1))
            if code_has_dom_access(code):
                return True

        # Check referenced script files
        page_dir = html_file.parent
        for match in SCRIPT_SRC_PATTERN.finditer(html_content):
            src = match.group(1)
            if src.startswith(('http://', 'https://', '//')):
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
                    if script.startswith(('http://', 'https://')):
                        continue
                    try:
                        script_path = ext_dir / script
                        if script_path.exists() and file_has_dom_access(script_path):
                            return (ext_name, True, True)
                    except Exception:
                        continue

        # Check background.page (HTML file with inline/referenced scripts)
        if 'page' in background:
            page = background['page']
            if isinstance(page, str) and page:
                if check_background_page(ext_dir, page):
                    return (ext_name, True, True)

        return (ext_name, True, False)

    except Exception:
        return (ext_dir.name if isinstance(ext_dir, Path) else str(ext_dir), False, False)


def process_extensions(extensions_dir: Path, verbose: bool = False, workers: Optional[int] = None) -> None:
    """Process all extensions and count those with DOM access."""
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
        description='Count MV2 extensions that would need an offscreen document after MV3 migration',
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
