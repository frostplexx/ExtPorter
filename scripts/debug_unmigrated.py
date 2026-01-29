#!/usr/bin/env python3
"""
Analyze why certain extensions on the filesystem were not imported into the database.

Compares INPUT_DIR against the database to find missing extensions and explains why
they weren't imported (Chrome Apps, Themes, already MV3, parse errors, etc.)

Usage:
    python debug_unmigrated.py [--uri URI] [--db DB] [--input-dir DIR] [--verbose]
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Set

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"


def connect_to_db(uri: str) -> MongoClient:
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def is_chrome_app(manifest: Dict[Any, Any] | None) -> bool:
    if not manifest or not isinstance(manifest, dict):
        return False
    return "app" in manifest


def is_theme(manifest: Dict[Any, Any] | None) -> bool:
    if not manifest or not isinstance(manifest, dict):
        return False
    return "theme" in manifest


def get_manifest_version(manifest: Dict[Any, Any] | None) -> int | None:
    if not manifest or not isinstance(manifest, dict):
        return None
    try:
        return int(manifest.get("manifest_version", 0))
    except (ValueError, TypeError):
        return None


def load_manifest(manifest_path: Path) -> Optional[Dict[Any, Any]]:
    """Try to load a manifest.json file, handling various encoding issues."""
    raw = None

    # 1) Try normal json.load with UTF-8
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        pass

    # 2) Try reading bytes and decoding with utf-8-sig to handle BOM
    try:
        raw = manifest_path.read_bytes()
        text = raw.decode("utf-8-sig")
        return json.loads(text)
    except Exception:
        pass

    # 3) Fallback: decode with replace and try to heuristically extract manifest_version
    try:
        if raw is None:
            raw = manifest_path.read_bytes()
        text = raw.decode("utf-8", errors="replace")
        # Try to extract at least manifest_version
        m = re.search(r'"manifest_version"\s*:\s*(\d+)', text)
        if m:
            mv = int(m.group(1))
            # Also try to extract app/theme markers
            manifest: Dict[str, Any] = {"manifest_version": mv}
            if '"app"' in text:
                manifest["app"] = {}
            if '"theme"' in text:
                manifest["theme"] = {}
            return manifest
    except Exception:
        pass

    return None


def get_filesystem_extensions(input_dir: Path) -> Dict[str, Dict[str, Any]]:
    """Get all extension IDs from the filesystem with their manifest info."""
    extensions = {}

    if not input_dir.exists():
        print(f"Error: INPUT_DIR does not exist: {input_dir}")
        return extensions

    for ext_dir in input_dir.iterdir():
        if not ext_dir.is_dir():
            continue

        ext_id = ext_dir.name
        manifest_path = ext_dir / "manifest.json"

        if not manifest_path.exists():
            extensions[ext_id] = {
                "id": ext_id,
                "manifest": None,
                "error": "no_manifest_file"
            }
            continue

        manifest = load_manifest(manifest_path)
        extensions[ext_id] = {
            "id": ext_id,
            "manifest": manifest,
            "error": "parse_error" if manifest is None else None
        }

    return extensions


def analyze_missing(
    client: MongoClient,
    db_name: str,
    input_dir: Path,
    verbose: bool = False
) -> Dict[str, Any]:
    """Compare filesystem extensions against database to find missing ones."""
    db = client[db_name]
    extensions_col = db["extensions"]

    # Get all extension IDs from database
    print("Loading extension IDs from database...")
    db_ids: Set[str] = set()
    for doc in extensions_col.find({}, {"id": 1}):
        if doc.get("id"):
            db_ids.add(doc["id"])

    print(f"Database contains: {len(db_ids)} extensions")

    # Get all extensions from filesystem
    print(f"Scanning filesystem: {input_dir}")
    fs_extensions = get_filesystem_extensions(input_dir)
    print(f"Filesystem contains: {len(fs_extensions)} directories")

    # Find missing extensions (in filesystem but not in database)
    missing_ids = set(fs_extensions.keys()) - db_ids
    print(f"Missing from database: {len(missing_ids)}")

    # Also check reverse (in DB but not filesystem) for completeness
    extra_in_db = db_ids - set(fs_extensions.keys())
    if extra_in_db:
        print(f"In database but not on filesystem: {len(extra_in_db)}")

    # Categorize missing extensions by reason
    reasons = {
        "chrome_app": [],
        "theme": [],
        "already_mv3": [],
        "manifest_parse_error": [],
        "no_manifest_file": [],
        "unknown": [],
    }

    for ext_id in missing_ids:
        ext_info = fs_extensions[ext_id]
        manifest = ext_info.get("manifest")
        error = ext_info.get("error")

        # No manifest file
        if error == "no_manifest_file":
            reasons["no_manifest_file"].append({"id": ext_id})
            continue

        # Parse error
        if error == "parse_error" or manifest is None:
            reasons["manifest_parse_error"].append({"id": ext_id})
            continue

        # Chrome App
        if is_chrome_app(manifest):
            reasons["chrome_app"].append({
                "id": ext_id,
                "name": manifest.get("name", "?")
            })
            continue

        # Theme
        if is_theme(manifest):
            reasons["theme"].append({
                "id": ext_id,
                "name": manifest.get("name", "?")
            })
            continue

        # Already MV3
        mv = get_manifest_version(manifest)
        if mv == 3:
            reasons["already_mv3"].append({
                "id": ext_id,
                "name": manifest.get("name", "?")
            })
            continue

        # Unknown reason
        reasons["unknown"].append({
            "id": ext_id,
            "name": manifest.get("name", "?") if manifest else "?",
            "manifest_version": mv,
        })

    return {
        "summary": {
            "filesystem_total": len(fs_extensions),
            "database_total": len(db_ids),
            "missing_from_db": len(missing_ids),
            "extra_in_db": len(extra_in_db),
        },
        "reasons": {k: len(v) for k, v in reasons.items()},
        "details": reasons if verbose else {k: v[:10] for k, v in reasons.items()},
        "extra_in_db_sample": list(extra_in_db)[:10] if extra_in_db else [],
    }


def print_results(results: Dict[str, Any], verbose: bool = False) -> None:
    s = results["summary"]
    print(f"\n{'=' * 70}")
    print(f"MISSING EXTENSIONS ANALYSIS")
    print(f"{'=' * 70}")
    print(f"Filesystem: {s['filesystem_total']}  |  Database: {s['database_total']}  |  Missing: {s['missing_from_db']}")

    if s["extra_in_db"] > 0:
        print(f"(Note: {s['extra_in_db']} extensions in DB but not on filesystem)")

    print(f"\n--- Reasons why extensions were not imported ---")
    total_explained = 0
    for reason, count in sorted(results["reasons"].items(), key=lambda x: -x[1]):
        if count > 0:
            pct = round(count / max(s["missing_from_db"], 1) * 100, 1)
            print(f"  {reason:30s} {count:6d}  ({pct}%)")
            total_explained += count

    print(f"\n  {'TOTAL EXPLAINED':30s} {total_explained:6d}")

    # Show examples from each category
    print(f"\n--- Examples from each category ---")
    for reason, examples in results["details"].items():
        if examples:
            shown = len(examples) if verbose else min(len(examples), 5)
            total_in_category = results["reasons"].get(reason, len(examples))
            print(f"\n  {reason} ({shown} of {total_in_category} shown):")
            for ex in examples[:shown]:
                ext_id = ex.get("id", "?")
                name = ex.get("name", "")
                mv = ex.get("manifest_version", "")
                extra = ""
                if name:
                    extra = f" - {name[:50]}"
                if mv:
                    extra += f" (MV{mv})"
                print(f"    {ext_id}{extra}")

    if results.get("extra_in_db_sample"):
        print(f"\n--- Sample of extensions in DB but not on filesystem ---")
        for ext_id in results["extra_in_db_sample"]:
            print(f"    {ext_id}")


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                break

    parser = argparse.ArgumentParser(
        description="Analyze why certain extensions on the filesystem were not imported into the database."
    )
    parser.add_argument(
        "--uri", type=str, default=os.environ.get("MONGODB_URI", DEFAULT_URI)
    )
    parser.add_argument(
        "--db", type=str, default=os.environ.get("DB_NAME", DEFAULT_DB)
    )
    parser.add_argument(
        "--input-dir", type=str, default=os.environ.get("INPUT_DIR"),
        help="Input directory containing extensions (default: from INPUT_DIR env var)"
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show all examples instead of just first few"
    )
    args = parser.parse_args()

    if not args.input_dir:
        print("Error: INPUT_DIR not specified. Use --input-dir or set INPUT_DIR env var.")
        sys.exit(1)

    input_dir = Path(args.input_dir)
    if not input_dir.exists():
        print(f"Error: INPUT_DIR does not exist: {input_dir}")
        sys.exit(1)

    client = connect_to_db(args.uri)
    try:
        results = analyze_missing(client, args.db, input_dir, args.verbose)
        print_results(results, args.verbose)
    finally:
        client.close()


if __name__ == "__main__":
    main()
