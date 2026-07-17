#!/usr/bin/env python3
"""
Compute migration success rate broken down by extension complexity.

Joins manual testing reports (overall_working) with extension complexity
metrics (interestingness_score, change classification tags) and prints
success rate per tier.

Usage:
    python success_by_complexity.py [--uri URI] [--db DB]
        [--mode {score,change-type}]
        [--exclude-mv2-broken]

Modes:
    score        – Bucket by interestingness_score (numeric complexity score):
                    0-10   simple
                    10-25  medium-low
                    25-50  medium
                    50-100 high
                    100+   very high
    change-type  – Bucket by change classification (trivial / semi-trivial /
                   non-trivial) using the same tag-based logic as
                   change_distribution.py.

MV2-broken filtering:
    Extensions that didn't work in MV2 (works_in_mv2=false) have
    overall_working set to "could_not_test" by the TUI and are already
    excluded from the working/failed counts.  --exclude-mv2-broken adds
    an extra explicit check for safety.

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

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

# ── Complexity score buckets ────────────────────────────────────────────────
SCORE_BUCKETS: List[Tuple[float, float, str]] = [
    (0, 10, "simple"),
    (10, 25, "medium-low"),
    (25, 50, "medium"),
    (50, 100, "high"),
    (100, float("inf"), "very high"),
]

# ── Change-type classification (mirrors change_distribution.py) ─────────────
TRIVIAL_TAGS = {"MANIFEST_MIGRATED", "CSP_VALUE_MODIFIED"}
SEMI_TRIVIAL_TAGS = {"API_RENAMES_APPLIED", "BRIDGE_INJECTED"}
NON_TRIVIAL_TAGS = {"DECLARATIVE_NET_REQUEST_MIGRATED", "OFFSCREEN_DOCUMENT_ADDED"}


def classify_change_type(tags: list) -> str:
    """Classify extension by the highest complexity tier of changes applied."""
    tag_set = set(tags or [])
    if tag_set & NON_TRIVIAL_TAGS:
        return "non-trivial"
    if tag_set & SEMI_TRIVIAL_TAGS:
        return "semi-trivial"
    if tag_set & TRIVIAL_TAGS:
        return "trivial"
    return "unclassified"


def bucket_score(score: float) -> str:
    """Assign a complexity bucket label for a given interestingness_score."""
    for lo, hi, label in SCORE_BUCKETS:
        if lo <= score < hi:
            return label
    return "unknown"


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                break

    parser = argparse.ArgumentParser(
        description="Compute migration success rate by extension complexity."
    )
    parser.add_argument(
        "--uri", type=str, default=os.environ.get("MONGODB_URI", DEFAULT_URI)
    )
    parser.add_argument("--db", type=str, default=os.environ.get("DB_NAME", DEFAULT_DB))
    parser.add_argument(
        "--mode",
        type=str,
        default="score",
        choices=["score", "change-type"],
        help="Complexity metric to use (default: score)",
    )
    parser.add_argument(
        "--exclude-mv2-broken",
        action="store_true",
        help="Exclude extensions that didn't work in MV2 (works_in_mv2=false)",
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
    reports_col = db["reports"]
    extensions_col = db["extensions"]

    # ── 1. Fetch all tested reports ──────────────────────────────────────
    reports = list(reports_col.find({"tested": True}))
    print(f"Total tested reports: {len(reports)}")

    if not reports:
        print("No tested reports found.")
        client.close()
        return

    # ── 2. Load matching extensions ──────────────────────────────────────
    ext_ids = [r["extension_id"] for r in reports if r.get("extension_id")]
    extensions = list(
        extensions_col.find(
            {"id": {"$in": ext_ids}},
            {
                "id": 1,
                "interestingness_score": 1,
                "tags": 1,
                "name": 1,
            },
        )
    )
    ext_map = {e["id"]: e for e in extensions}
    print(f"Matching extensions:   {len(ext_map)}")

    # ── 3. Classify each report ──────────────────────────────────────────
    bucket_total: Dict[str, int] = Counter()
    bucket_working: Dict[str, int] = Counter()
    total_working = 0
    total_failed = 0
    could_not_test = 0
    excluded_mv2_broken = 0

    for r in reports:
        ext_id = r.get("extension_id")
        ext = ext_map.get(ext_id)

        # Optionally skip extensions that were already broken in MV2
        if args.exclude_mv2_broken and r.get("works_in_mv2") is False:
            excluded_mv2_broken += 1
            continue

        overall = r.get("overall_working")

        if overall == "could_not_test":
            could_not_test += 1
            continue
        elif overall == "yes":
            total_working += 1
        elif overall == "no":
            total_failed += 1
        else:
            could_not_test += 1
            continue

        # Determine bucket
        if args.mode == "score":
            score = (ext or {}).get("interestingness_score") or 0
            bucket = bucket_score(score)
        else:
            tags = (ext or {}).get("tags") or []
            bucket = classify_change_type(tags)

        bucket_total[bucket] += 1
        if overall == "yes":
            bucket_working[bucket] += 1

    client.close()

    # ── 4. Print results ─────────────────────────────────────────────────
    all_tested = total_working + total_failed
    overall_rate = (total_working / all_tested * 100) if all_tested else 0.0

    print(f"\n{'=' * 70}")
    print(f"SUCCESS RATE BY COMPLEXITY  (mode: {args.mode})")
    print(f"{'=' * 70}")

    if args.mode == "score":
        print("Score buckets:  0-10 simple | 10-25 medium-low | 25-50 medium |"
              " 50-100 high | 100+ very high")
    else:
        print("Change types: trivial < semi-trivial < non-trivial")

    if args.exclude_mv2_broken:
        print(f"Excluded MV2-broken: {excluded_mv2_broken}")

    print(f"Tested: {all_tested}  |  Working: {total_working}  |  "
          f"Failed: {total_failed}  |  Could not test: {could_not_test}")
    print(f"Overall success rate: {overall_rate:.1f}%")
    print()

    # Header
    bucket_order = (
        ["simple", "medium-low", "medium", "high", "very high", "unclassified"]
        if args.mode == "score"
        else ["trivial", "semi-trivial", "non-trivial", "unclassified"]
    )

    print(f"{'Complexity':<20s} {'Total':>8s} {'Working':>8s} {'Failed':>8s} {'Rate':>8s}")
    print("-" * 55)

    for bucket in bucket_order:
        total = bucket_total.get(bucket, 0)
        if total == 0:
            continue
        working = bucket_working.get(bucket, 0)
        failed = total - working
        rate = working / total * 100
        bar = "█" * max(1, round(rate / 4))
        print(f"{bucket:<20s} {total:>8d} {working:>8d} {failed:>8d} "
              f"{rate:>6.1f}%  {bar}")

    print("-" * 55)
    print(f"{'TOTAL':<20s} {all_tested:>8d} {total_working:>8d} "
          f"{total_failed:>8d} {overall_rate:>6.1f}%")

    # Score mode: show median/mean per bucket
    if args.mode == "score" and extensions:
        print(f"\n{'─' * 55}")
        print("Score distribution per bucket:")
        bucket_scores: Dict[str, list] = {}
        for ext in extensions:
            s = ext.get("interestingness_score") or 0
            b = bucket_score(s)
            bucket_scores.setdefault(b, []).append(s)

        print(f"{'Bucket':<20s} {'Count':>6s} {'Mean':>8s} {'Median':>8s} {'Min':>6s} {'Max':>6s}")
        print("-" * 55)
        for b in bucket_order:
            scores = bucket_scores.get(b, [])
            if not scores:
                continue
            scores.sort()
            mean = sum(scores) / len(scores)
            median = scores[len(scores) // 2]
            print(f"{b:<20s} {len(scores):>6d} {mean:>7.1f} {median:>7.1f} "
                  f"{scores[0]:>5.0f} {scores[-1]:>5.0f}")


if __name__ == "__main__":
    main()
