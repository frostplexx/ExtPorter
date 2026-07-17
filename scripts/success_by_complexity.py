#!/usr/bin/env python3
"""
Compute migration success rate broken down by change complexity.

Joins manual testing reports (overall_working) with extension tags to
classify each extension as trivial / semi-trivial / non-trivial, then
prints success rate per tier.

Usage:
    python success_by_complexity.py [--uri URI] [--db DB] [--exclude-mv2-broken]

Requirements:
    pip install pymongo python-dotenv
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
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"

# Change-type classification (mirrors change_distribution.py)
TRIVIAL_TAGS = {"MANIFEST_MIGRATED", "CSP_VALUE_MODIFIED"}
SEMI_TRIVIAL_TAGS = {"API_RENAMES_APPLIED", "BRIDGE_INJECTED"}
NON_TRIVIAL_TAGS = {"DECLARATIVE_NET_REQUEST_MIGRATED", "OFFSCREEN_DOCUMENT_ADDED"}
TIER_ORDER = ["trivial", "semi-trivial", "non-trivial", "unclassified"]


def classify(tags: list) -> str:
    """Highest complexity tier based on which migration tags are present."""
    s = set(tags or [])
    if s & NON_TRIVIAL_TAGS:
        return "non-trivial"
    if s & SEMI_TRIVIAL_TAGS:
        return "semi-trivial"
    if s & TRIVIAL_TAGS:
        return "trivial"
    return "unclassified"


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for p in [script_dir / ".env", script_dir.parent / ".env"]:
            if p.exists():
                load_dotenv(p)
                break

    parser = argparse.ArgumentParser(
        description="Migration success rate by change complexity."
    )
    parser.add_argument("--uri", type=str,
                        default=os.environ.get("MONGODB_URI", DEFAULT_URI))
    parser.add_argument("--db", type=str,
                        default=os.environ.get("DB_NAME", DEFAULT_DB))
    parser.add_argument("--exclude-mv2-broken", action="store_true",
                        help="Skip reports where works_in_mv2 is false")
    args = parser.parse_args()

    try:
        client = MongoClient(args.uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
    except Exception as e:
        print(f"Error: {e}")
        sys.exit(1)

    db = client[args.db]

    # 1. Reports
    reports = list(db["reports"].find({"tested": True}))
    if not reports:
        print("No tested reports found.")
        client.close()
        return

    # 2. Extensions
    ext_ids = [r["extension_id"] for r in reports if r.get("extension_id")]
    ext_map = {}
    for e in db["extensions"].find({"id": {"$in": ext_ids}}, {"id": 1, "tags": 1}):
        ext_map[e["id"]] = e

    client.close()

    print(f"Reports: {len(reports)}  |  Extensions: {len(ext_map)}")

    # 3. Classify
    counts: dict = {t: {"total": 0, "working": 0} for t in TIER_ORDER}
    could_not_test = 0
    excluded_mv2 = 0

    for r in reports:
        if args.exclude_mv2_broken and r.get("works_in_mv2") is False:
            excluded_mv2 += 1
            continue

        ow = r.get("overall_working")
        if ow == "could_not_test" or ow not in ("yes", "no"):
            could_not_test += 1
            continue

        ext = ext_map.get(r.get("extension_id"))
        tier = classify(ext.get("tags") if ext else None)

        counts[tier]["total"] += 1
        if ow == "yes":
            counts[tier]["working"] += 1

    # 4. Print
    total = sum(c["total"] for c in counts.values())
    working = sum(c["working"] for c in counts.values())
    failed = total - working

    print(f"\n{'=' * 55}")
    print("SUCCESS RATE BY CHANGE COMPLEXITY")
    print(f"{'=' * 55}")
    if args.exclude_mv2_broken:
        print(f"Excluded MV2-broken: {excluded_mv2}")
    print(f"Tested: {total}  |  Working: {working}  |  "
          f"Failed: {failed}  |  Could not test: {could_not_test}")
    rate = (working / total * 100) if total else 0.0
    print(f"Overall success rate: {rate:.1f}%")
    print()

    print(f"{'Complexity':<18s} {'Total':>7s} {'Working':>8s} "
          f"{'Failed':>7s} {'Rate':>7s}")
    print("-" * 52)

    for tier in TIER_ORDER:
        c = counts[tier]
        if c["total"] == 0:
            continue
        w = c["working"]
        f = c["total"] - w
        r = w / c["total"] * 100
        bar = "█" * max(1, round(r / 4))
        print(f"{tier:<18s} {c['total']:>7d} {w:>8d} {f:>7d} {r:>6.1f}%  {bar}")

    print("-" * 52)
    print(f"{'TOTAL':<18s} {total:>7d} {working:>8d} {failed:>7d} {rate:>6.1f}%")


if __name__ == "__main__":
    main()
