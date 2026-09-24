#!/usr/bin/env python3
"""
Remove extensions marked as 'could_not_test' in the Sonnet 4.5 CSV from the
downloaded_extensions directory by moving them to excluded_extensions/.

Usage:
    python filter_untestable.py [--csv PATH] [--ext-dir PATH] [--dry-run]
"""

import argparse
import csv
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_CSV = Path.home() / "Downloads" / "extension_unified" / "LLM Fixed Extensions-Sonnet 4.5.csv"
DEFAULT_EXT_DIR = BASE_DIR / "downloaded_extensions"
DEFAULT_EXCL_DIR = BASE_DIR / "excluded_extensions"


def load_could_not_test(csv_path: Path) -> set[str]:
    could_not_test = set()
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("overall_working", "").strip() == "could_not_test":
                ext_id = row.get("extension_id", "").strip()
                if ext_id and ext_id != "-":
                    could_not_test.add(ext_id)
    return could_not_test


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", default=str(DEFAULT_CSV),
                        help=f"path to the Sonnet 4.5 CSV (default: {DEFAULT_CSV})")
    parser.add_argument("--ext-dir", default=str(DEFAULT_EXT_DIR),
                        help=f"downloaded extensions directory (default: {DEFAULT_EXT_DIR})")
    parser.add_argument("--excl-dir", default=str(DEFAULT_EXCL_DIR),
                        help=f"destination for excluded extensions (default: {DEFAULT_EXCL_DIR})")
    parser.add_argument("--dry-run", action="store_true",
                        help="print what would be moved without doing it")
    args = parser.parse_args()

    csv_path = Path(args.csv)
    ext_dir = Path(args.ext_dir)
    excl_dir = Path(args.excl_dir)

    if not csv_path.exists():
        raise SystemExit(f"ERROR: CSV not found: {csv_path}")
    if not ext_dir.is_dir():
        raise SystemExit(f"ERROR: extension directory not found: {ext_dir}")

    could_not_test = load_could_not_test(csv_path)
    print(f"Found {len(could_not_test)} could_not_test extension IDs in CSV")

    moved = []
    missing = []
    for ext_id in sorted(could_not_test):
        src = ext_dir / ext_id
        if not src.exists():
            missing.append(ext_id)
            continue
        dst = excl_dir / ext_id
        if args.dry_run:
            print(f"  [dry-run] would move {src} -> {dst}")
        else:
            excl_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(src), str(dst))
            print(f"  moved {ext_id} -> excluded_extensions/")
        moved.append(ext_id)

    print(f"\nSummary:")
    print(f"  {'Would move' if args.dry_run else 'Moved'}:  {len(moved)}")
    print(f"  Not in ext-dir (already absent): {len(missing)}")
    if missing:
        for eid in missing:
            print(f"    - {eid}")


if __name__ == "__main__":
    main()
