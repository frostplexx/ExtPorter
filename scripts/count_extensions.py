#!/usr/bin/env python3
"""
Count extensions by type from both MongoDB and INPUT_DIR.

Counts:
- Total extensions
- Manifest V3 extensions
- Manifest V2 extensions
- Chrome Apps
- Themes
- Regular extensions (not apps or themes)

Usage:
    python count_extensions.py [output_csv] [--uri URI] [--db DB] [--input-dir DIR]

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import csv
import json
import re
import os
import sys
from pathlib import Path
from typing import Dict, Optional

try:
    from dotenv import load_dotenv
except ImportError:
    print("Warning: python-dotenv not installed. Run: pip install python-dotenv")
    load_dotenv = None

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"
EXTENSIONS_COLLECTION = "extensions"


def connect_to_db(uri: str) -> Optional[MongoClient]:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Warning: Could not connect to MongoDB: {e}")
        return None


def is_chrome_app(manifest: Dict) -> bool:
    """Check if manifest represents a Chrome App."""
    if not manifest:
        return False
    return "app" in manifest


def is_theme(manifest: Dict) -> bool:
    """Check if manifest represents a Theme."""
    if not manifest:
        return False
    return "theme" in manifest


def is_manifest_v3(manifest: Dict) -> bool:
    """Check if manifest is version 3."""
    if not manifest:
        return False
    return manifest.get("manifest_version") == 3


def count_from_database(client: MongoClient, db_name: str) -> Dict[str, int]:
    """Count extensions by type from MongoDB."""
    db = client[db_name]
    collection = db[EXTENSIONS_COLLECTION]

    stats = {
        "total": 0,
        "manifest_v2": 0,
        "manifest_v3": 0,
        "chrome_apps": 0,
        "themes": 0,
        "regular_extensions": 0,
    }

    cursor = collection.find({}, {"manifest": 1})

    for ext in cursor:
        stats["total"] += 1
        manifest = ext.get("manifest", {})

        if is_manifest_v3(manifest):
            stats["manifest_v3"] += 1
        else:
            stats["manifest_v2"] += 1

        if is_chrome_app(manifest):
            stats["chrome_apps"] += 1
        elif is_theme(manifest):
            stats["themes"] += 1
        else:
            stats["regular_extensions"] += 1

    return stats


def count_from_input_dir(input_dir: Path) -> Dict[str, int]:
    """Count extensions by type from INPUT_DIR.

    This implementation is robust to common issues:
    - Handles UTF-8 BOM by decoding with `utf-8-sig` when needed
    - Falls back to a heuristic regex to extract `manifest_version` when JSON is malformed
    - Always increments `total` so filesystem totals aren't lost on parse errors
    """
    stats = {
        "total": 0,
        "manifest_v2": 0,
        "manifest_v3": 0,
        "chrome_apps": 0,
        "themes": 0,
        "regular_extensions": 0,
    }

    if not input_dir.exists():
        print(f"Warning: INPUT_DIR does not exist: {input_dir}")
        return stats

    # Find all manifest.json files
    for ext_dir in input_dir.iterdir():
        if not ext_dir.is_dir():
            continue

        manifest_path = ext_dir / "manifest.json"
        if not manifest_path.exists():
            continue

        manifest = None
        raw = None

        # 1) Try normal json.load with UTF-8
        try:
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            # 2) Try reading bytes and decoding with utf-8-sig to handle BOM
            try:
                raw = manifest_path.read_bytes()
                text = raw.decode("utf-8-sig")
                manifest = json.loads(text)
            except Exception:
                # 3) Fallback: decode with replace and try to heuristically extract manifest_version
                try:
                    if raw is None:
                        raw = manifest_path.read_bytes()
                    text = raw.decode("utf-8", errors="replace")
                    m = re.search(r'"manifest_version"\s*:\s*(\d+)', text)
                    if m:
                        mv = int(m.group(1))
                        manifest = {"manifest_version": mv}
                    else:
                        # give up on parsing JSON content but keep counting
                        manifest = None
                        print(
                            f"Warning: Could not parse {manifest_path} (falling back to minimal classification)"
                        )
                except Exception as e:
                    manifest = None
                    print(f"Warning: Could not parse {manifest_path}: {e}")

        # Always count as total even if manifest couldn't be parsed
        stats["total"] += 1

        # If we found at least manifest_version, classify by manifest_version
        if manifest:
            if is_manifest_v3(manifest):
                stats["manifest_v3"] += 1
            else:
                stats["manifest_v2"] += 1

            if is_chrome_app(manifest):
                stats["chrome_apps"] += 1
            elif is_theme(manifest):
                stats["themes"] += 1
            else:
                stats["regular_extensions"] += 1
        else:
            # Unknown manifest — count as a regular extension so totals are preserved
            stats["regular_extensions"] += 1

    return stats


def export_to_csv(
    db_stats: Optional[Dict[str, int]],
    input_stats: Optional[Dict[str, int]],
    output_path: Path,
) -> None:
    """Export stats to CSV file."""
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        headers = ["category"]
        if db_stats:
            headers.append("database_count")
        if input_stats:
            headers.append("input_dir_count")
        writer.writerow(headers)

        categories = [
            "total",
            "manifest_v2",
            "manifest_v3",
            "chrome_apps",
            "themes",
            "regular_extensions",
        ]
        for category in categories:
            row: list = [category]
            if db_stats:
                row.append(db_stats.get(category, 0))
            if input_stats:
                row.append(input_stats.get(category, 0))
            writer.writerow(row)

    print(f"Exported to: {output_path}")


def main():
    # Load .env file if available
    if load_dotenv:
        # Look for .env in script directory and parent directories
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                print(f"Loaded environment from: {env_path}")
                break

    parser = argparse.ArgumentParser(
        description="Count extensions by type from MongoDB and/or INPUT_DIR."
    )
    parser.add_argument(
        "output_csv",
        type=str,
        nargs="?",
        default="extension_counts.csv",
        help="Output CSV file path (default: extension_counts.csv)",
    )
    parser.add_argument(
        "--uri",
        type=str,
        default=os.environ.get("MONGODB_URI", DEFAULT_URI),
        help=f"MongoDB URI (default: from MONGODB_URI env var or {DEFAULT_URI})",
    )
    parser.add_argument(
        "--db",
        type=str,
        default=os.environ.get("DB_NAME", DEFAULT_DB),
        help=f"Database name (default: from DB_NAME env var or {DEFAULT_DB})",
    )
    parser.add_argument(
        "--input-dir",
        type=str,
        default=os.environ.get("INPUT_DIR"),
        help="Input directory containing extensions (default: from INPUT_DIR env var)",
    )
    parser.add_argument(
        "--skip-db",
        action="store_true",
        help="Skip counting from database",
    )
    parser.add_argument(
        "--skip-input-dir",
        action="store_true",
        help="Skip counting from INPUT_DIR",
    )

    args = parser.parse_args()
    output_path = Path(args.output_csv)

    db_stats = None
    input_stats = None

    # Count from database
    if not args.skip_db:
        print("Connecting to MongoDB...")
        client = connect_to_db(args.uri)
        if client:
            try:
                print(f"Counting extensions in '{args.db}.{EXTENSIONS_COLLECTION}'...")
                db_stats = count_from_database(client, args.db)
                print(f"\nDatabase results:")
                for key, value in db_stats.items():
                    print(f"  {key}: {value:,}")
            finally:
                client.close()

    # Count from INPUT_DIR
    if not args.skip_input_dir and args.input_dir:
        input_dir = Path(args.input_dir)
        print(f"\nCounting extensions in INPUT_DIR: {input_dir}...")
        input_stats = count_from_input_dir(input_dir)
        print(f"\nINPUT_DIR results:")
        for key, value in input_stats.items():
            print(f"  {key}: {value:,}")
    elif not args.skip_input_dir and not args.input_dir:
        print("\nNo INPUT_DIR specified, skipping filesystem count.")

    if db_stats or input_stats:
        export_to_csv(db_stats, input_stats, output_path)
    else:
        print("\nNo data to export.")

    print("\nDone.")


if __name__ == "__main__":
    main()
