#!/usr/bin/env python3
"""
Reproduce thesis Table 5.3: migration change categories among verified extensions.

Counts extensions (with at least one report) that required each type of
migration change, based on pipeline tags and feature analysis.

Usage:
    python count_migration_changes.py [--uri URI] [--db DB]
"""

import argparse
import os
import sys
from collections import Counter
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

    parser = argparse.ArgumentParser(
        description="Count migration change categories among verified extensions."
    )
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

    # 1. Get extensions that have at least one report ("verified")
    rep_ext_ids = set(
        db["reports"].distinct("extension_id", {"extension_id": {"$ne": None}})
    )
    print(f"Extensions with reports: {len(rep_ext_ids)}")

    # 2. Load those extensions with tags + interestingness_breakdown
    exts = list(
        db["extensions"].find(
            {"id": {"$in": list(rep_ext_ids)}},
            {"id": 1, "tags": 1, "interestingness_breakdown": 1},
        )
    )
    print(f"Extensions matched in DB: {len(exts)}")
    client.close()

    # 3. Count each category
    counts = Counter()

    for e in exts:
        tags = set(e.get("tags") or [])
        breakdown = e.get("interestingness_breakdown") or {}

        # 1. Manifest updates
        if "MANIFEST_MIGRATED" in tags:
            counts["Manifest updates"] += 1

        # 2. Bridge script injection
        if "BRIDGE_INJECTED" in tags:
            counts["Bridge script injection"] += 1

        # 3. Transitioning from BP to SW
        # Extensions that had a background page (in MV2) needed this transition.
        # Detected either by HAS_BACKGROUND_PAGE tag or background_page score > 0.
        if "HAS_BACKGROUND_PAGE" in tags or breakdown.get("background_page", 0) > 0:
            counts["Transitioning from BP to SW"] += 1

        # 4. API renaming
        if "API_RENAMES_APPLIED" in tags:
            counts["API renaming"] += 1

        # 5. CSP modifications
        if "CSP_VALUE_MODIFIED" in tags:
            counts["CSP modifications"] += 1

        # 6. Offscreen document injection
        if "OFFSCREEN_DOCUMENT_ADDED" in tags:
            counts["Offscreen document injection"] += 1

        # 7. Request interception logic (webRequest → DNR)
        if "DECLARATIVE_NET_REQUEST_MIGRATED" in tags:
            counts["Request interception logic"] += 1

    # 4. Print table
    rows = [
        "Manifest updates",
        "Bridge script injection",
        "Transitioning from BP to SW",
        "API renaming",
        "CSP modifications",
        "Offscreen document injection",
        "Request interception logic",
    ]

    print(f"\n{'Required Change':<40s} {'Count':>6s}")
    print("-" * 48)
    for r in rows:
        print(f"{r:<40s} {counts.get(r, 0):>6d}")
    print("-" * 48)
    print(f"{'Total extensions':<40s} {len(exts):>6d}")
    print()
    print("(An extension can require multiple changes, so counts exceed total.)")


if __name__ == "__main__":
    main()
