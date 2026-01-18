#!/usr/bin/env python3
"""
Backfill user count data from CWS HTML files into MongoDB.

This script re-parses CWS HTML files and updates the userCount field
in the cws_info.details for all extensions in the database.

Usage:
    python backfill_user_count.py --cws-dir /path/to/cws/html/files [--uri URI] [--dry-run]

Arguments:
    --cws-dir: Path to directory containing CWS HTML files (required)
    --uri: MongoDB URI (default: mongodb://admin:password@localhost:27017/migrator?authSource=admin)
    --db: Database name (default: migrator)
    --dry-run: Show what would be updated without making changes

Requirements:
    pip install pymongo beautifulsoup4 lxml
"""

import argparse
import os
import re
import sys
from pathlib import Path
from typing import Dict, Optional

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)

try:
    from bs4 import BeautifulSoup
except ImportError:
    print(
        "Error: beautifulsoup4 is not installed. Run: pip install beautifulsoup4 lxml"
    )
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


def get_cws_extension_id(extension: Dict) -> Optional[str]:
    """
    Extract the Chrome Web Store extension ID from the extension.

    The CWS ID is the folder name, which is the basename of manifest_v2_path.
    For example: /path/to/extensions/ppppahbmgjnmiioildpbclepjmfcbggo -> ppppahbmgjnmiioildpbclepjmfcbggo
    """
    manifest_v2_path = extension.get("manifest_v2_path")
    if manifest_v2_path:
        return os.path.basename(manifest_v2_path)
    return None


def extract_user_count(html_path: Path) -> Optional[str]:
    """Extract user count from a CWS HTML file."""
    try:
        with open(html_path, "r", encoding="utf-8", errors="ignore") as f:
            html = f.read()

        soup = BeautifulSoup(html, "lxml")

        # User count is in div with class F9iKBc (e.g., "2,000 users" or "5,000,000+ users")
        # There may be multiple elements with this class, so we need to find the one
        # that contains the user count pattern
        user_count_els = soup.select(".F9iKBc")
        for el in user_count_els:
            text = el.get_text(strip=True)
            # Match patterns like "2,000 users", "5,000,000+ users", "10 users"
            if re.match(r"^[\d,]+\+?\s*users?$", text, re.IGNORECASE):
                return text

        # Fallback: try to find any text matching the user count pattern in F9iKBc elements
        for el in user_count_els:
            text = el.get_text(strip=True)
            # Extract just the user count part if it's embedded in other text
            match = re.search(r"([\d,]+\+?\s*users?)", text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None
    except Exception as e:
        print(f"  Error parsing {html_path.name}: {e}")
        return None


def find_cws_html(cws_dir: Path, extension_id: str) -> Optional[Path]:
    """Find the CWS HTML file for an extension."""
    # Try direct match with extension ID
    html_path = cws_dir / f"{extension_id}.html"
    if html_path.exists():
        return html_path
    return None


def backfill_user_counts(
    client: MongoClient,
    db_name: str,
    cws_dir: Path,
    dry_run: bool = False,
) -> Dict[str, int]:
    """Backfill user count data from CWS HTML files."""
    db = client[db_name]
    collection = db[EXTENSIONS_COLLECTION]

    # Get all extensions with manifest_v2_path for CWS ID extraction
    extensions = list(
        collection.find({}, {"id": 1, "manifest_v2_path": 1, "cws_info": 1})
    )
    print(f"Found {len(extensions)} extensions in database")

    stats = {
        "total": len(extensions),
        "updated": 0,
        "already_has_value": 0,
        "no_html_file": 0,
        "no_user_count_found": 0,
        "no_cws_id": 0,
        "errors": 0,
    }

    for i, ext in enumerate(extensions, 1):
        ext_id = ext.get("id")
        if not ext_id:
            continue

        # Get the CWS extension ID from manifest_v2_path
        cws_ext_id = get_cws_extension_id(ext)
        if not cws_ext_id:
            stats["no_cws_id"] += 1
            continue

        # Check if already has user count
        cws_info = ext.get("cws_info") or {}
        details = cws_info.get("details") or {}
        existing_user_count = details.get("userCount")

        if existing_user_count:
            stats["already_has_value"] += 1
            continue

        # Find CWS HTML file using the CWS extension ID (folder name)
        html_path = find_cws_html(cws_dir, cws_ext_id)
        if not html_path:
            stats["no_html_file"] += 1
            continue

        # Extract user count
        user_count = extract_user_count(html_path)
        if not user_count:
            stats["no_user_count_found"] += 1
            continue

        # Update the database
        if dry_run:
            print(
                f"  [DRY-RUN] Would update {ext_id} (CWS: {cws_ext_id}): userCount = {user_count}"
            )
            stats["updated"] += 1
        else:
            try:
                result = collection.update_one(
                    {"id": ext_id},
                    {"$set": {"cws_info.details.userCount": user_count}},
                )
                if result.modified_count > 0:
                    stats["updated"] += 1
                    if stats["updated"] <= 10 or stats["updated"] % 100 == 0:
                        print(
                            f"  Updated {ext_id} (CWS: {cws_ext_id}): userCount = {user_count}"
                        )
            except Exception as e:
                print(f"  Error updating {ext_id}: {e}")
                stats["errors"] += 1

        # Progress indicator
        if i % 500 == 0:
            print(f"Progress: {i}/{len(extensions)} processed...")

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Backfill user count data from CWS HTML files into MongoDB."
    )
    parser.add_argument(
        "--cws-dir",
        type=str,
        required=True,
        help="Path to directory containing CWS HTML files",
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
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be updated without making changes",
    )

    args = parser.parse_args()

    cws_dir = Path(args.cws_dir)
    if not cws_dir.exists() or not cws_dir.is_dir():
        print(f"Error: CWS directory does not exist: {cws_dir}")
        sys.exit(1)

    # Count HTML files
    html_files = list(cws_dir.glob("*.html"))
    print(f"Found {len(html_files)} HTML files in {cws_dir}")

    if args.dry_run:
        print("\n*** DRY RUN MODE - No changes will be made ***\n")

    print("Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        print(f"\nBackfilling user counts from '{cws_dir}'...")
        stats = backfill_user_counts(client, args.db, cws_dir, dry_run=args.dry_run)

        print(f"\n{'=' * 55}")
        print("Summary")
        print(f"{'=' * 55}")
        print(f"Total extensions:        {stats['total']}")
        print(f"Updated:                 {stats['updated']}")
        print(f"Already had value:       {stats['already_has_value']}")
        print(f"No CWS ID (no path):     {stats['no_cws_id']}")
        print(f"No HTML file found:      {stats['no_html_file']}")
        print(f"No user count in HTML:   {stats['no_user_count_found']}")
        print(f"Errors:                  {stats['errors']}")

        if args.dry_run:
            print("\n*** DRY RUN - No changes were made ***")

    finally:
        client.close()
        print("\nConnection closed.")


if __name__ == "__main__":
    main()
