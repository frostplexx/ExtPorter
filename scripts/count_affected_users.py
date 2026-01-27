#!/usr/bin/env python3
"""
Count total affected users across all MV2 extensions in the database.

Sums up cws_info.details.userCount for extensions with manifest_version 2.

Usage:
    python count_affected_users.py [--uri URI] [--db DB]

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
    cleaned = re.sub(
        r"[,\s+]", "", user_count_str.lower().replace("users", "").replace("user", "")
    )
    try:
        return int(cleaned)
    except ValueError:
        return None


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

    cursor = col.find(
        {"manifest.manifest_version": 2},
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

    print(f"\nMV2 extensions:          {total_exts:>12,}")
    print(f"  with user count:       {with_count:>12,}")
    print(f"  without user count:    {without_count:>12,}")
    print(f"\nTotal affected users:    {total_users:>12,}")

    if top:
        print(f"\nTop 20 by installs:")
        for count, name in top[:20]:
            print(f"  {count:>14,}  {name}")


if __name__ == "__main__":
    main()
