#!/usr/bin/env python3
"""
Reproduce thesis Table 5.1: migration outcomes by interestingness.

Only considers extensions that have at least one report.
- Top 100:    highest interestingness_score among those with reports
- Bottom 100: lowest interestingness_score among those with reports
- Random:     random sample from all extensions with reports

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
    from pymongo import MongoClient
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

    # 1. Load all reports and collect unique extension_ids
    reports = list(db["reports"].find({}, {"extension_id": 1, "overall_working": 1, "tested_date": 1}))
    print(f"Total reports: {len(reports)}")

    # Group reports by extension_id, keep latest per extension
    ext_reports: dict[str, list] = {}
    for r in reports:
        eid = r.get("extension_id")
        if eid:
            ext_reports.setdefault(eid, []).append(r)

    print(f"Extensions with reports: {len(ext_reports)}")

    # 2. Load interestingness_score for those extensions
    scored = {}
    for e in db["extensions"].find(
        {"id": {"$in": list(ext_reports.keys())}},
        {"id": 1, "interestingness_score": 1},
    ):
        sid = e["id"]
        score = e.get("interestingness_score")
        if score is not None:
            scored[sid] = score

    print(f"Extensions with score + report: {len(scored)}")
    client.close()

    # 3. Sort by score, partition
    sorted_ids = sorted(scored.keys(), key=lambda eid: scored[eid])
    n = len(sorted_ids)
    top_n = 100
    bottom_n = 100
    random_n = 300

    if n < top_n + bottom_n + random_n:
        print(f"Only {n} extensions — need at least {top_n + bottom_n + random_n}")
        return

    bottom_ids = set(sorted_ids[:bottom_n])
    top_ids = set(sorted_ids[-top_n:])
    middle_ids = [eid for eid in sorted_ids if eid not in bottom_ids and eid not in top_ids]
    random_ids = set(random.sample(middle_ids, random_n))

    groups = {
        "Bottom 100": bottom_ids,
        "Random":     random_ids,
        "Top 100":    top_ids,
    }

    # 4. Classify per group (use latest report per extension)
    def classify(eid: str) -> str:
        reps = ext_reports.get(eid, [])
        if not reps:
            return "Not Testable"
        latest = max(reps, key=lambda r: r.get("tested_date", ""))
        ow = latest.get("overall_working")
        if ow == "yes":
            return "Working"
        elif ow == "no":
            return "Not Working"
        else:
            return "Not Testable"

    result = {g: Counter() for g in groups}
    for label, ids in groups.items():
        for eid in ids:
            result[label][classify(eid)] += 1

    # 5. Print table
    print()
    print(f"{'Outcome':<20s} {'Top 100':>8s} {'Random':>8s} {'Bottom 100':>8s}")
    print("-" * 48)
    for o in ["Working", "Not Working", "Not Testable"]:
        vals = [result[g].get(o, 0) for g in ["Top 100", "Random", "Bottom 100"]]
        print(f"{o:<20s} {vals[0]:>8d} {vals[1]:>8d} {vals[2]:>8d}")
    print("-" * 48)
    totals = [sum(result[g].values()) for g in ["Top 100", "Random", "Bottom 100"]]
    print(f"{'Total':<20s} {totals[0]:>8d} {totals[1]:>8d} {totals[2]:>8d}")
    print()
    print(f"(Random sample drawn from {len(middle_ids)} middle-scored extensions)")


if __name__ == "__main__":
    main()
