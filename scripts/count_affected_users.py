#!/usr/bin/env python3
"""
Count total affected users across all MV2 extensions in the database.

Sums up cws_info.details.userCount for extensions with manifest_version 2.

Usage:
    python count_affected_users.py [--uri URI] [--db DB] [--status {all,success,failed,partial}]

Examples:
    # All migrated extensions (default)
    python count_affected_users.py

    # Only successfully migrated
    python count_affected_users.py --status success

    # Only failed migrations
    python count_affected_users.py --status failed

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import os
import re
import sys
from pathlib import Path

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


def parse_user_count(user_count_str):
    """Parse user count string to integer. E.g. '2,000,000+ users' -> 2000000"""
    if not user_count_str:
        return None
    # Strip everything except digits and commas, then remove commas
    cleaned = re.sub(r"[^\d,]", "", user_count_str).replace(",", "")
    if not cleaned:
        return None
    try:
        return int(cleaned)
    except ValueError:
        return None


def build_status_filter(status: str) -> dict:
    """Build MongoDB query filter for the given migration status."""
    if status == "all":
        return {}
    if status == "success":
        # Must have MANIFEST_MIGRATED and no failure/partial tags
        return {
            "$and": [
                {"tags": "MANIFEST_MIGRATED"},
                {"tags": {"$nin": ["MIGRATION_FAILED", "PARTIAL_MIGRATION"]}},
            ]
        }
    if status == "failed":
        return {"tags": "MIGRATION_FAILED"}
    if status == "partial":
        return {"tags": "PARTIAL_MIGRATION"}
    return {}


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                break

    parser = argparse.ArgumentParser(
        description="Count total affected users across MV2 extensions."
    )
    parser.add_argument(
        "--uri", type=str, default=os.environ.get("MONGODB_URI", DEFAULT_URI)
    )
    parser.add_argument("--db", type=str, default=os.environ.get("DB_NAME", DEFAULT_DB))
    parser.add_argument(
        "--status",
        type=str,
        default="all",
        choices=["all", "success", "failed", "partial"],
        help="Filter by migration status (default: all)",
    )
    args = parser.parse_args()

    try:
        client = MongoClient(args.uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    db = client[args.db]
    col = db["extensions"]

    # Debug: check what manifest_version values exist
    sample = col.find_one({}, {"manifest.manifest_version": 1})
    if sample:
        mv = (sample.get("manifest") or {}).get("manifest_version")
        print(f"Sample manifest_version: {mv!r} (type={type(mv).__name__})")

    # Count by manifest version to understand the data
    total_docs = col.count_documents({})
    mv2_dot = col.count_documents({"manifest.manifest_version": 2})
    mv3_dot = col.count_documents({"manifest.manifest_version": 3})
    mv2_str = col.count_documents({"manifest.manifest_version": "2"})
    has_mv3_id = col.count_documents({"mv3_extension_id": {"$ne": None}})
    print(
        f"Total docs: {total_docs}, mv==2: {mv2_dot}, mv==3: {mv3_dot}, mv=='2': {mv2_str}, has_mv3_id: {has_mv3_id}"
    )

    # Extensions are MV2 sources if they were the original input.
    # After migration, the same document gets mv3_extension_id set but the
    # manifest field may have been updated to v3. So we query all extensions
    # that have an mv3_extension_id (meaning they were migrated from MV2),
    # or whose manifest_version is still 2.
    base_filter = {
        "$or": [
            {"manifest.manifest_version": 2},
            {"manifest.manifest_version": "2"},
            {"mv3_extension_id": {"$ne": None}},
        ]
    }

    # Apply status filter
    status_filter = build_status_filter(args.status)
    query_filter = (
        {"$and": [base_filter, status_filter]} if status_filter else base_filter
    )

    matching = col.count_documents(query_filter)
    print(f"Status filter: {args.status} -> {matching} matching extensions")

    cursor = col.find(
        query_filter,
        {"name": 1, "id": 1, "cws_info.details.userCount": 1},
    )

    total_users = 0
    with_count = 0
    without_count = 0
    total_exts = 0
    top = []

    for ext in cursor:
        total_exts += 1
        raw = None
        cws = ext.get("cws_info")
        if cws:
            raw = (cws.get("details") or {}).get("userCount")
        count = parse_user_count(raw)
        if count is not None:
            total_users += count
            with_count += 1
            top.append((count, ext.get("name", ext.get("id", "?"))))
        else:
            without_count += 1

    client.close()

    top.sort(reverse=True)

    label = f"Extensions ({args.status})"
    print(f"\n{label:40s} {total_exts:>12,}")
    print(f"  with user count:       {with_count:>12,}")
    print(f"  without user count:    {without_count:>12,}")
    print(f"\nTotal affected users:    {total_users:>12,}")

    if top:
        print(f"\nTop 20 by installs:")
        for count, name in top[:20]:
            print(f"  {count:>14,}  {name}")


if __name__ == "__main__":
    main()
