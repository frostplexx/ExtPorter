#!/usr/bin/env python3
"""
Count how many reports have needs_login=true, with breakdown by overall_working.

Usage:
    python count_needs_login.py [--uri URI] [--db DB]
"""

import argparse
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo not installed. Run: pip install pymongo")
    sys.exit(1)

DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"

def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for p in [script_dir / ".env", script_dir.parent / ".env"]:
            if p.exists():
                load_dotenv(p)
                break

    parser = argparse.ArgumentParser()
    parser.add_argument("--uri", type=str,
                        default=os.environ.get("MONGODB_URI", DEFAULT_URI))
    parser.add_argument("--db", type=str,
                        default=os.environ.get("DB_NAME", DEFAULT_DB))
    args = parser.parse_args()

    try:
        client = MongoClient(args.uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    db = client[args.db]
    reports = db["reports"]

    total_login = reports.count_documents({"needs_login": True})
    tested_login = reports.count_documents({"needs_login": True, "tested": True})

    print(f"needs_login = true:  {total_login}")
    print(f"  of which tested:   {tested_login}")
    print()

    pipe = [
        {"$match": {"needs_login": True}},
        {"$group": {"_id": "$overall_working", "count": {"$sum": 1}}},
    ]
    print("Breakdown by overall_working:")
    for r in reports.aggregate(pipe):
        print(f"  {r['_id'] or '<missing>':30s} {r['count']}")

    # Also show unique extension count
    unique = len(reports.distinct("extension_id", {"needs_login": True}))
    print(f"\nUnique extensions: {unique}")

    client.close()

if __name__ == "__main__":
    main()
