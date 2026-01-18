#!/usr/bin/env python3
"""
Count extensions by type from MongoDB and output as CSV.

Counts:
- Total extensions
- Manifest V3 extensions
- Chrome Apps
- Themes
- Regular extensions (not apps or themes)

Usage:
    python count_extensions.py [output_csv] [--uri URI] [--db DB]

Requirements:
    pip install pymongo
"""

import argparse
import csv
import sys
from pathlib import Path
from typing import Dict

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"
EXTENSIONS_COLLECTION = "extensions"


def connect_to_db(uri: str) -> MongoClient:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def is_chrome_app(manifest: Dict) -> bool:
    """Check if manifest represents a Chrome App."""
    if not manifest:
        return False
    # Chrome Apps have an "app" key with "background" or "launch" properties
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


def count_extensions(client: MongoClient, db_name: str) -> Dict[str, int]:
    """Count extensions by type."""
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

    # Fetch all extensions with just the manifest field
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


def export_to_csv(stats: Dict[str, int], output_path: Path) -> None:
    """Export stats to CSV file."""
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["category", "count"])
        for key, value in stats.items():
            writer.writerow([key, value])

    print(f"Exported to: {output_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Count extensions by type from MongoDB and output as CSV."
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
        default=DEFAULT_URI,
        help=f"MongoDB URI (default: {DEFAULT_URI})",
    )
    parser.add_argument(
        "--db",
        type=str,
        default=DEFAULT_DB,
        help=f"Database name (default: {DEFAULT_DB})",
    )

    args = parser.parse_args()
    output_path = Path(args.output_csv)

    print("Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        print(f"Counting extensions in '{args.db}.{EXTENSIONS_COLLECTION}'...")
        stats = count_extensions(client, args.db)

        print(f"\nResults:")
        for key, value in stats.items():
            print(f"  {key}: {value:,}")

        export_to_csv(stats, output_path)

    finally:
        client.close()
        print("Connection closed.")


if __name__ == "__main__":
    main()
