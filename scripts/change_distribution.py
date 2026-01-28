#!/usr/bin/env python3
"""
Compute the distribution of trivial, semi-trivial, and non-trivial migration
changes across all migrated MV2 extensions and export the results to CSV.

Definitions (based on the bachelor thesis):
  Trivial       – Only manifest.json updates (manifest_version bump, permissions
                  restructuring, CSP adjustments).  No code changes.
  Semi-Trivial  – Code changes that follow well-defined mechanical patterns:
                  deprecated API renames, file modifications for those renames.
  Non-Trivial   – Significant architectural changes: background page → service
                  worker conversion, webRequest → declarativeNetRequest migration,
                  offscreen document injection, bridge injection.

Each extension is classified into exactly ONE dominant category (the highest
complexity tier it touches).  Additionally, per-extension counts of each tier
are recorded so you can analyse overlaps.

The CSV contains:
  1. Per-extension rows with raw counts and dominant category.
  2. A summary section with distribution statistics (mean, median, stddev,
     quartiles, IQR, and outlier bounds).

Usage:
    python change_distribution.py [--uri URI] [--db DB] [--csv output.csv]

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import csv
import math
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Tuple

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

# ── Tags that indicate each category ────────────────────────────────────────

TRIVIAL_TAGS = {
    "MANIFEST_MIGRATED",
    "CSP_VALUE_MODIFIED",
}

SEMI_TRIVIAL_TAGS = {
    "API_RENAMES_APPLIED",
}

NON_TRIVIAL_TAGS = {
    "DECLARATIVE_NET_REQUEST_MIGRATED",
    "BRIDGE_INJECTED",
    "OFFSCREEN_DOCUMENT_ADDED",
}

# ── Interestingness breakdown fields per category ───────────────────────────

TRIVIAL_FIELDS = ["manifest_changes"]
SEMI_TRIVIAL_FIELDS = ["api_renames", "file_modifications"]
NON_TRIVIAL_FIELDS = [
    "webRequest",
    "webRequest_to_dnr_migrations",
]


def connect_to_db(uri: str) -> MongoClient:
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def classify_extension(ext: dict) -> Dict[str, Any]:
    """Classify a single extension's migration changes."""
    tags = set(ext.get("tags", []))
    breakdown = ext.get("interestingness_breakdown", {})

    # Count changes per tier
    trivial_count = 0
    semi_trivial_count = 0
    non_trivial_count = 0

    # Trivial: manifest changes
    for field in TRIVIAL_FIELDS:
        val = breakdown.get(field, 0)
        if val and val > 0:
            trivial_count += int(val)
    for tag in TRIVIAL_TAGS:
        if tag in tags:
            trivial_count += 1

    # Semi-trivial: API renames, file modifications
    for field in SEMI_TRIVIAL_FIELDS:
        val = breakdown.get(field, 0)
        if val and val > 0:
            semi_trivial_count += int(val)
    for tag in SEMI_TRIVIAL_TAGS:
        if tag in tags:
            semi_trivial_count += 1

    # Non-trivial: webRequest, DNR, background page, bridge, offscreen
    for field in NON_TRIVIAL_FIELDS:
        val = breakdown.get(field, 0)
        if val and val > 0:
            non_trivial_count += int(val)
    for tag in NON_TRIVIAL_TAGS:
        if tag in tags:
            non_trivial_count += 1

    total = trivial_count + semi_trivial_count + non_trivial_count

    # Dominant category: highest tier that has any changes
    if non_trivial_count > 0:
        dominant = "non-trivial"
    elif semi_trivial_count > 0:
        dominant = "semi-trivial"
    elif trivial_count > 0:
        dominant = "trivial"
    else:
        dominant = "none"

    return {
        "id": ext.get("id", ""),
        "name": ext.get("name", ""),
        "trivial_count": trivial_count,
        "semi_trivial_count": semi_trivial_count,
        "non_trivial_count": non_trivial_count,
        "total_changes": total,
        "dominant_category": dominant,
        "interestingness_score": ext.get("interestingness", 0),
    }


def percentile(sorted_vals: List[float], p: float) -> float:
    """Compute the p-th percentile (0-100) from a sorted list."""
    if not sorted_vals:
        return 0.0
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def compute_stats(values: List[float]) -> Dict[str, float]:
    """Compute descriptive statistics including outlier bounds."""
    if not values:
        return {
            "n": 0, "mean": 0, "median": 0, "stddev": 0,
            "min": 0, "max": 0,
            "q1": 0, "q3": 0, "iqr": 0,
            "lower_fence": 0, "upper_fence": 0,
            "outlier_count": 0,
        }
    s = sorted(values)
    n = len(s)
    mean = sum(s) / n
    variance = sum((x - mean) ** 2 for x in s) / n
    stddev = math.sqrt(variance)
    median = percentile(s, 50)
    q1 = percentile(s, 25)
    q3 = percentile(s, 75)
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr
    outlier_count = sum(1 for x in s if x < lower_fence or x > upper_fence)

    return {
        "n": n,
        "mean": round(mean, 2),
        "median": round(median, 2),
        "stddev": round(stddev, 2),
        "min": s[0],
        "max": s[-1],
        "q1": round(q1, 2),
        "q3": round(q3, 2),
        "iqr": round(iqr, 2),
        "lower_fence": round(lower_fence, 2),
        "upper_fence": round(upper_fence, 2),
        "outlier_count": outlier_count,
    }


def run(client: MongoClient, db_name: str) -> Tuple[List[Dict], Dict]:
    db = client[db_name]
    extensions_col = db["extensions"]

    # Migrated extensions have mv3_extension_id set by the migration pipeline
    query = {
        "mv3_extension_id": {"$exists": True, "$ne": None},
    }
    extensions = list(extensions_col.find(query))
    print(f"Found {len(extensions)} migrated extensions")

    # Debug: sample a few extensions to inspect actual field values
    if extensions:
        print("\n--- DEBUG: Sample of 3 extensions ---")
        for ext in extensions[:3]:
            print(f"  id={ext.get('id', '?')}")
            print(f"    tags={ext.get('tags', [])}")
            print(f"    breakdown={ext.get('interestingness_breakdown', {})}")
            print()

    rows = [classify_extension(ext) for ext in extensions]

    # Distribution of dominant category
    cat_counts = Counter(r["dominant_category"] for r in rows)
    print(f"\nDominant category distribution:")
    for cat in ["trivial", "semi-trivial", "non-trivial", "none"]:
        count = cat_counts.get(cat, 0)
        pct = round(count / max(len(rows), 1) * 100, 1)
        print(f"  {cat:15s} {count:5d}  ({pct}%)")

    # Stats per count column
    stats = {}
    for key in ["trivial_count", "semi_trivial_count", "non_trivial_count",
                 "total_changes", "interestingness_score"]:
        vals = [float(r[key]) for r in rows]
        stats[key] = compute_stats(vals)

    return rows, stats


def export_csv(rows: List[Dict], stats: Dict, path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)

        # Per-extension data
        header = [
            "extension_id", "name",
            "trivial_count", "semi_trivial_count", "non_trivial_count",
            "total_changes", "dominant_category", "interestingness_score",
        ]
        w.writerow(header)
        for r in sorted(rows, key=lambda x: x["total_changes"], reverse=True):
            w.writerow([
                r["id"], r["name"],
                r["trivial_count"], r["semi_trivial_count"],
                r["non_trivial_count"], r["total_changes"],
                r["dominant_category"], r["interestingness_score"],
            ])

        # Blank separator
        w.writerow([])
        w.writerow([])

        # Summary statistics
        w.writerow(["=== Distribution Summary ==="])
        cat_counts = Counter(r["dominant_category"] for r in rows)
        total = max(len(rows), 1)
        w.writerow(["category", "count", "percentage"])
        for cat in ["trivial", "semi-trivial", "non-trivial", "none"]:
            count = cat_counts.get(cat, 0)
            w.writerow([cat, count, round(count / total * 100, 2)])

        w.writerow([])
        w.writerow(["=== Descriptive Statistics ==="])
        stat_header = [
            "metric", "n", "mean", "median", "stddev", "min", "max",
            "q1", "q3", "iqr", "lower_fence", "upper_fence", "outlier_count",
        ]
        w.writerow(stat_header)
        for key, s in stats.items():
            w.writerow([key] + [s[h] for h in stat_header[1:]])

        # Outlier list
        w.writerow([])
        w.writerow(["=== Outliers (by total_changes) ==="])
        total_stats = stats["total_changes"]
        w.writerow(["extension_id", "name", "total_changes", "dominant_category",
                     "trivial_count", "semi_trivial_count", "non_trivial_count",
                     "interestingness_score"])
        for r in sorted(rows, key=lambda x: x["total_changes"], reverse=True):
            tc = r["total_changes"]
            if tc < total_stats["lower_fence"] or tc > total_stats["upper_fence"]:
                w.writerow([
                    r["id"], r["name"], r["total_changes"],
                    r["dominant_category"],
                    r["trivial_count"], r["semi_trivial_count"],
                    r["non_trivial_count"], r["interestingness_score"],
                ])

    print(f"\nExported to: {path}")


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                break

    parser = argparse.ArgumentParser(
        description="Distribution of trivial / semi-trivial / non-trivial migration changes."
    )
    parser.add_argument(
        "--uri", type=str, default=os.environ.get("MONGODB_URI", DEFAULT_URI)
    )
    parser.add_argument(
        "--db", type=str, default=os.environ.get("DB_NAME", DEFAULT_DB)
    )
    parser.add_argument(
        "--csv", type=str, default="change_distribution.csv",
        help="CSV output path (default: change_distribution.csv)",
    )
    args = parser.parse_args()

    client = connect_to_db(args.uri)
    try:
        rows, stats = run(client, args.db)
        export_csv(rows, stats, args.csv)
    finally:
        client.close()


if __name__ == "__main__":
    main()
