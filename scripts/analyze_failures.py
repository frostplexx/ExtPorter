#!/usr/bin/env python3
"""
Analyze the most common failure reasons for extensions that didn't work after MV2->MV3 migration.

Correlates data from:
- reports collection (manual testing: overall_working, is_popup_working, etc.)
- extensions collection (tags, interestingness_breakdown, event_listeners)
- logs collection (error logs for failed extensions)

Field types in the reports collection (set by the Rust TUI client):
- overall_working: string "yes" | "no" | "could_not_test"
- is_popup_working: boolean
- is_settings_working: boolean
- is_new_tab_working: boolean
- has_errors: boolean (often absent/null)
- needs_login: boolean
- works_in_mv2: boolean
- installs: boolean
- notes: string

Usage:
    python analyze_failures.py [--uri URI] [--db DB] [--csv output.csv]

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import csv
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional

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


def connect_to_db(uri: str) -> MongoClient:
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def is_report_failed(r: dict) -> bool:
    """Check if a report indicates the extension failed after migration."""
    # overall_working is a string: "yes", "no", "could_not_test"
    if r.get("overall_working") == "no":
        return True
    # is_popup_working, is_settings_working, is_new_tab_working are booleans
    if r.get("is_popup_working") is False:
        return True
    if r.get("is_settings_working") is False:
        return True
    if r.get("is_new_tab_working") is False:
        return True
    # has_errors is a boolean (often absent)
    if r.get("has_errors") is True:
        return True
    return False


def is_report_working(r: dict) -> bool:
    """Check if a report indicates the extension works after migration."""
    return r.get("overall_working") == "yes"


def analyze_failures(client: MongoClient, db_name: str) -> Dict[str, Any]:
    db = client[db_name]
    reports_col = db["reports"]
    extensions_col = db["extensions"]
    logs_col = db["logs"]

    # --- 1. Load all tested reports and classify ---
    all_reports = list(reports_col.find({"tested": True}))
    print(f"Total tested reports: {len(all_reports)}")

    # Show distribution of overall_working values
    working_vals = Counter(r.get("overall_working", "<missing>") for r in all_reports)
    print(f"overall_working distribution: {dict(working_vals)}")

    failed_reports = [r for r in all_reports if is_report_failed(r)]
    working_reports = [r for r in all_reports if is_report_working(r)]
    could_not_test = [
        r for r in all_reports if r.get("overall_working") == "could_not_test"
    ]

    print(
        f"Failed: {len(failed_reports)}  |  Working: {len(working_reports)}  |  Could not test: {len(could_not_test)}"
    )

    if not failed_reports:
        print("No failed reports found.")
        return {}

    failed_ext_ids = [r["extension_id"] for r in failed_reports]
    working_ext_ids = [r["extension_id"] for r in working_reports]

    # --- 2. Symptom breakdown ---
    symptoms = Counter()
    for r in failed_reports:
        if r.get("overall_working") == "no":
            symptoms["overall_not_working"] += 1
        if r.get("is_popup_working") is False:
            symptoms["popup_broken"] += 1
        if r.get("is_settings_working") is False:
            symptoms["settings_broken"] += 1
        if r.get("is_new_tab_working") is False:
            symptoms["new_tab_broken"] += 1
        if r.get("has_errors") is True:
            symptoms["has_errors"] += 1
        if r.get("seems_slower") is True:
            symptoms["seems_slower"] += 1
        if r.get("installs") is False:
            symptoms["does_not_install"] += 1

    # --- 3. Fetch extensions for failed and working reports ---
    failed_exts = list(extensions_col.find({"id": {"$in": failed_ext_ids}}))
    failed_ext_map = {e["id"]: e for e in failed_exts}
    working_exts = list(extensions_col.find({"id": {"$in": working_ext_ids}}))

    n_failed = max(len(failed_exts), 1)
    n_working = max(len(working_exts), 1)

    # --- 4. Tag frequency analysis (failed vs working) ---
    failed_tags = Counter()
    working_tags = Counter()

    for ext in failed_exts:
        for tag in ext.get("tags", []):
            failed_tags[tag] += 1
    for ext in working_exts:
        for tag in ext.get("tags", []):
            working_tags[tag] += 1

    tag_overrep = {}
    all_tags = set(failed_tags.keys()) | set(working_tags.keys())
    for tag in all_tags:
        failed_rate = failed_tags.get(tag, 0) / n_failed
        working_rate = working_tags.get(tag, 0) / n_working
        if failed_rate > 0:
            ratio = (
                round(failed_rate / working_rate, 2)
                if working_rate > 0
                else float("inf")
            )
            tag_overrep[tag] = {
                "failed_count": failed_tags.get(tag, 0),
                "failed_pct": round(failed_rate * 100, 1),
                "working_count": working_tags.get(tag, 0),
                "working_pct": round(working_rate * 100, 1),
                "ratio": ratio,
            }

    # --- 5. Interestingness breakdown analysis ---
    failed_scores = Counter()
    working_scores = Counter()

    score_fields = [
        "webRequest",
        "html_lines",
        "storage_local",
        "background_page",
        "content_scripts",
        "dangerous_permissions",
        "host_permissions",
        "crypto_patterns",
        "network_requests",
        "extension_size",
        "api_renames",
        "manifest_changes",
        "file_modifications",
        "webRequest_to_dnr_migrations",
    ]

    for ext in failed_exts:
        breakdown = ext.get("interestingness_breakdown", {})
        for field in score_fields:
            val = breakdown.get(field, 0)
            if val and val > 0:
                failed_scores[field] += 1

    for ext in working_exts:
        breakdown = ext.get("interestingness_breakdown", {})
        for field in score_fields:
            val = breakdown.get(field, 0)
            if val and val > 0:
                working_scores[field] += 1

    feature_overrep = {}
    for field in score_fields:
        failed_rate = failed_scores.get(field, 0) / n_failed
        working_rate = working_scores.get(field, 0) / n_working
        if failed_rate > 0:
            ratio = (
                round(failed_rate / working_rate, 2)
                if working_rate > 0
                else float("inf")
            )
            feature_overrep[field] = {
                "failed_count": failed_scores.get(field, 0),
                "failed_pct": round(failed_rate * 100, 1),
                "working_count": working_scores.get(field, 0),
                "working_pct": round(working_rate * 100, 1),
                "ratio": ratio,
            }

    # --- 6. API usage in failed extensions (from event_listeners) ---
    failed_apis = Counter()
    for ext in failed_exts:
        seen = set()
        for listener in ext.get("event_listeners", []):
            api = listener.get("api", "unknown")
            if api not in seen:
                failed_apis[api] += 1
                seen.add(api)

    # --- 7. Error log analysis ---
    error_logs = list(
        logs_col.find(
            {
                "loglevel": {"$in": ["error", "warning"]},
                "extension.id": {"$in": failed_ext_ids},
            }
        )
    )

    error_messages = Counter()
    for log in error_logs:
        msg = log.get("message", "")
        normalized = msg[:120].strip()
        if normalized:
            error_messages[normalized] += 1

    # --- 8. Notes from reports ---
    notes = []
    for r in failed_reports:
        if r.get("notes"):
            notes.append(
                {
                    "extension_id": r["extension_id"],
                    "name": failed_ext_map.get(r["extension_id"], {}).get("name", "?"),
                    "notes": r["notes"],
                }
            )

    # --- 9. Listener test results (which APIs fail most) ---
    listener_failures = Counter()
    listener_totals = Counter()
    for r in failed_reports:
        for lr in r.get("listeners", []):
            api = lr.get("api", "unknown")
            listener_totals[api] += 1
            if lr.get("status") == "no":
                listener_failures[api] += 1

    return {
        "summary": {
            "total_tested": len(all_reports),
            "total_failed": len(failed_reports),
            "total_working": len(working_reports),
            "total_could_not_test": len(could_not_test),
            "failure_rate_pct": round(
                len(failed_reports) / max(len(all_reports), 1) * 100, 1
            ),
        },
        "symptoms": symptoms.most_common(),
        "tag_overrepresentation": sorted(
            tag_overrep.items(),
            key=lambda x: (
                x[1]["ratio"] if x[1]["ratio"] != float("inf") else 9999,
                x[1]["failed_pct"],
            ),
            reverse=True,
        ),
        "feature_overrepresentation": sorted(
            feature_overrep.items(),
            key=lambda x: (
                x[1]["ratio"] if x[1]["ratio"] != float("inf") else 9999,
                x[1]["failed_pct"],
            ),
            reverse=True,
        ),
        "top_apis_in_failures": failed_apis.most_common(20),
        "top_error_messages": error_messages.most_common(20),
        "listener_failure_rates": sorted(
            [
                (
                    api,
                    listener_failures[api],
                    listener_totals[api],
                    round(listener_failures[api] / listener_totals[api] * 100, 1),
                )
                for api in listener_totals
                if listener_failures[api] > 0
            ],
            key=lambda x: x[1],
            reverse=True,
        ),
        "notes": notes,
    }


def print_results(results: Dict[str, Any]) -> None:
    if not results:
        return

    s = results["summary"]
    print(f"\n{'=' * 70}")
    print(f"MIGRATION FAILURE ANALYSIS")
    print(f"{'=' * 70}")
    print(
        f"Tested: {s['total_tested']}  |  Failed: {s['total_failed']}  |  "
        f"Working: {s['total_working']}  |  Could not test: {s['total_could_not_test']}  |  "
        f"Failure rate: {s['failure_rate_pct']}%"
    )

    print(f"\n--- Symptoms ---")
    for symptom, count in results["symptoms"]:
        print(f"  {symptom:30s} {count:4d}")

    if results["summary"]["total_working"] > 0:
        print(f"\n--- Tags overrepresented in failures (vs working) ---")
        for tag, info in results["tag_overrepresentation"][:15]:
            ratio_str = (
                f"{info['ratio']:.1f}x"
                if info["ratio"] != float("inf")
                else "inf (only in failures)"
            )
            print(
                f"  {str(tag):40s} failed={info['failed_pct']:5.1f}% ({info['failed_count']})  "
                f"working={info['working_pct']:5.1f}% ({info['working_count']})  ratio={ratio_str}"
            )
    else:
        print(f"\n--- Tags in failed extensions (no working group for comparison) ---")
        for tag, info in results["tag_overrepresentation"][:15]:
            print(
                f"  {str(tag):40s} {info['failed_pct']:5.1f}% ({info['failed_count']} extensions)"
            )

    if results["summary"]["total_working"] > 0:
        print(f"\n--- Features overrepresented in failures ---")
        for feat, info in results["feature_overrepresentation"][:15]:
            ratio_str = (
                f"{info['ratio']:.1f}x" if info["ratio"] != float("inf") else "inf"
            )
            print(
                f"  {feat:40s} failed={info['failed_pct']:5.1f}% ({info['failed_count']})  "
                f"working={info['working_pct']:5.1f}% ({info['working_count']})  ratio={ratio_str}"
            )
    else:
        print(f"\n--- Features in failed extensions ---")
        for feat, info in results["feature_overrepresentation"][:15]:
            print(
                f"  {feat:40s} {info['failed_pct']:5.1f}% ({info['failed_count']} extensions)"
            )

    print(f"\n--- Top APIs used by failed extensions ---")
    for api, count in results["top_apis_in_failures"]:
        print(f"  {api:50s} {count:4d}")

    print(f"\n--- Top error messages ---")
    for msg, count in results["top_error_messages"]:
        print(f"  [{count:3d}x] {msg}")

    if results["listener_failure_rates"]:
        print(f"\n--- Listener APIs that fail most often ---")
        for api, fails, total, pct in results["listener_failure_rates"][:15]:
            print(f"  {api:50s} {fails}/{total} ({pct}%)")

    if results["notes"]:
        print(f"\n--- Tester notes on failed extensions ---")
        for n in results["notes"][:20]:
            print(f"  [{n['extension_id']}] {n['name']}: {n['notes']}")


def export_csv(results: Dict[str, Any], path: str) -> None:
    if not results:
        return

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)

        w.writerow(["=== Summary ==="])
        for k, v in results["summary"].items():
            w.writerow([k, v])

        w.writerow([])
        w.writerow(["=== Symptoms ==="])
        w.writerow(["symptom", "count"])
        for symptom, count in results["symptoms"]:
            w.writerow([symptom, count])

        w.writerow([])
        w.writerow(["=== Tag Overrepresentation ==="])
        w.writerow(
            [
                "tag",
                "failed_count",
                "failed_pct",
                "working_count",
                "working_pct",
                "ratio",
            ]
        )
        for tag, info in results["tag_overrepresentation"]:
            ratio = info["ratio"] if info["ratio"] != float("inf") else "inf"
            w.writerow(
                [
                    tag,
                    info["failed_count"],
                    info["failed_pct"],
                    info["working_count"],
                    info["working_pct"],
                    ratio,
                ]
            )

        w.writerow([])
        w.writerow(["=== Feature Overrepresentation ==="])
        w.writerow(
            [
                "feature",
                "failed_count",
                "failed_pct",
                "working_count",
                "working_pct",
                "ratio",
            ]
        )
        for feat, info in results["feature_overrepresentation"]:
            ratio = info["ratio"] if info["ratio"] != float("inf") else "inf"
            w.writerow(
                [
                    feat,
                    info["failed_count"],
                    info["failed_pct"],
                    info["working_count"],
                    info["working_pct"],
                    ratio,
                ]
            )

        w.writerow([])
        w.writerow(["=== Top APIs in Failures ==="])
        w.writerow(["api", "count"])
        for api, count in results["top_apis_in_failures"]:
            w.writerow([api, count])

        w.writerow([])
        w.writerow(["=== Top Error Messages ==="])
        w.writerow(["message", "count"])
        for msg, count in results["top_error_messages"]:
            w.writerow([msg, count])

        w.writerow([])
        w.writerow(["=== Listener Failure Rates ==="])
        w.writerow(["api", "failures", "total", "fail_pct"])
        for api, fails, total, pct in results["listener_failure_rates"]:
            w.writerow([api, fails, total, pct])

    print(f"\nExported to: {path}")


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                break

    parser = argparse.ArgumentParser(
        description="Analyze common failure reasons for migrated extensions."
    )
    parser.add_argument(
        "--uri", type=str, default=os.environ.get("MONGODB_URI", DEFAULT_URI)
    )
    parser.add_argument("--db", type=str, default=os.environ.get("DB_NAME", DEFAULT_DB))
    parser.add_argument(
        "--csv", type=str, default=None, help="Optional CSV output path"
    )
    args = parser.parse_args()

    client = connect_to_db(args.uri)
    try:
        results = analyze_failures(client, args.db)
        print_results(results)
        if args.csv:
            export_csv(results, args.csv)
    finally:
        client.close()


if __name__ == "__main__":
    main()
