#!/usr/bin/env python3
"""
Reproduce thesis Table 5.1: migration outcomes by interestingness terciles.

Groups extensions by interestingness_score (Top 100, Random 100, Bottom 100),
then classifies each tested report as Working / Not Working / Not Testable.

Usage:
    python thesis_table.py [--uri URI] [--db DB]
"""

import argparse
import os
import random
import sys
from collections import Counter
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

try:
    from pymongo import MongoClient, ASCENDING
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
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
        description="Reproduce thesis Table 5.1: outcomes by interestingness."
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

    # 1. Load all extensions with interestingness_score
    all_exts = list(
        db["extensions"].find(
            {"interestingness_score": {"$exists": True}},
            {"id": 1, "interestingness_score": 1},
        )
    )
    all_exts.sort(key=lambda e: e.get("interestingness_score", 0))

    if len(all_exts) < 500:
        print(f"Only {len(all_exts)} extensions with scores, need ≥500")
        client.close()
        return

    # 2. Partition: bottom 100, random 300 (from middle), top 100
    bottom = all_exts[:100]
    top = all_exts[-100:]
    middle = all_exts[100:-100]
    sampled = random.sample(middle, min(300, len(middle)))

    groups = {
        "Bottom 100": {e["id"] for e in bottom},
        "Random":     {e["id"] for e in sampled},
        "Top 100":    {e["id"] for e in top},
    }

    # 3. Fetch reports for these extensions
    all_ids = set()
    for g in groups.values():
        all_ids |= g

    reports = list(db["reports"].find({"extension_id": {"$in": list(all_ids)}}))
    ext_reports: dict[str, list] = {}
    for r in reports:
        eid = r.get("extension_id")
        if eid:
            ext_reports.setdefault(eid, []).append(r)

    client.close()

    # 4. Classify per group
    outcomes = ["Working", "Not Working", "Not Testable"]
    result = {g: Counter() for g in groups}

    for label, ids in groups.items():
        for eid in ids:
            reps = ext_reports.get(eid, [])
            if not reps:
                result[label]["Not Testable"] += 1
                continue
            # Use the latest report per extension
            latest = max(reps, key=lambda r: r.get("tested_date", ""))
            ow = latest.get("overall_working")
            if ow == "yes":
                result[label]["Working"] += 1
            elif ow == "no":
                result[label]["Not Working"] += 1
            else:
                result[label]["Not Testable"] += 1

    # 5. Print table
    print()
    print(f"{'Outcome':<20s} {'Top 100':>8s} {'Random':>8s} {'Bottom 100':>8s}")
    print("-" * 48)
    for o in outcomes:
        top_v = result["Top 100"].get(o, 0)
        rand_v = result["Random"].get(o, 0)
        bot_v = result["Bottom 100"].get(o, 0)
        print(f"{o:<20s} {top_v:>8d} {rand_v:>8d} {bot_v:>8d}")
    print("-" * 48)
    total_t = sum(result["Top 100"].values())
    total_r = sum(result["Random"].values())
    total_b = sum(result["Bottom 100"].values())
    print(f"{'Total':<20s} {total_t:>8d} {total_r:>8d} {total_b:>8d}")
    print()


if __name__ == "__main__":
    main()
