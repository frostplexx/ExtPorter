#!/usr/bin/env python3
"""
Analyze why certain extensions were not migrated (no mv3_extension_id).

Checks for:
- Chrome Apps (not migratable)
- Themes (not migratable)
- Already MV3 (don't need migration)
- Migration errors
- Missing/invalid manifests
- Other reasons

Usage:
    python debug_unmigrated.py [--uri URI] [--db DB] [--verbose]
"""

import argparse
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List

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


def is_chrome_app(manifest: Dict[Any, Any] | None) -> bool:
    if not manifest or not isinstance(manifest, dict):
        return False
    return "app" in manifest


def is_theme(manifest: Dict[Any, Any] | None) -> bool:
    if not manifest or not isinstance(manifest, dict):
        return False
    return "theme" in manifest


def get_manifest_version(manifest: Dict[Any, Any] | None) -> int | None:
    if not manifest or not isinstance(manifest, dict):
        return None
    try:
        return int(manifest.get("manifest_version", 0))
    except (ValueError, TypeError):
        return None


def analyze_unmigrated(client: MongoClient, db_name: str, verbose: bool = False) -> Dict[str, Any]:
    db = client[db_name]
    extensions_col = db["extensions"]

    # Get total count
    total_count = extensions_col.count_documents({})

    # Get migrated count
    migrated_count = extensions_col.count_documents({
        "mv3_extension_id": {"$exists": True, "$ne": None}
    })

    # Get unmigrated extensions (no mv3_extension_id or it's null)
    unmigrated_query = {
        "$or": [
            {"mv3_extension_id": {"$exists": False}},
            {"mv3_extension_id": None}
        ]
    }

    unmigrated = list(extensions_col.find(unmigrated_query))

    print(f"\nTotal extensions: {total_count}")
    print(f"Migrated: {migrated_count}")
    print(f"Unmigrated: {len(unmigrated)}")
    print(f"Discrepancy check: {migrated_count} + {len(unmigrated)} = {migrated_count + len(unmigrated)} (should be {total_count})")

    # Categorize reasons
    reasons = {
        "chrome_app": [],
        "theme": [],
        "already_mv3": [],
        "has_migration_error": [],
        "has_error_field": [],
        "missing_manifest": [],
        "invalid_manifest": [],
        "has_skip_tag": [],
        "unknown": [],
    }

    # Track all fields present in unmigrated docs
    all_fields = Counter()
    error_messages = Counter()
    skip_tags = Counter()
    tag_counts = Counter()

    for ext in unmigrated:
        ext_id = ext.get("id", ext.get("_id", "unknown"))
        name = ext.get("name", "Unknown")
        manifest = ext.get("manifest")
        tags = ext.get("tags", [])

        # Track all fields
        for field in ext.keys():
            all_fields[field] += 1

        # Track tags
        for tag in tags:
            tag_counts[tag] += 1

        categorized = False

        # Check for Chrome App
        if is_chrome_app(manifest):
            reasons["chrome_app"].append({"id": ext_id, "name": name})
            categorized = True
            continue

        # Check for Theme
        if is_theme(manifest):
            reasons["theme"].append({"id": ext_id, "name": name})
            categorized = True
            continue

        # Check for already MV3
        mv = get_manifest_version(manifest)
        if mv == 3:
            reasons["already_mv3"].append({"id": ext_id, "name": name})
            categorized = True
            continue

        # Check for missing manifest
        if manifest is None:
            reasons["missing_manifest"].append({"id": ext_id, "name": name})
            categorized = True
            continue

        # Check for invalid manifest (not a dict)
        if not isinstance(manifest, dict):
            reasons["invalid_manifest"].append({
                "id": ext_id,
                "name": name,
                "manifest_type": type(manifest).__name__
            })
            categorized = True
            continue

        # Check for migration error field
        migration_error = ext.get("migration_error") or ext.get("error") or ext.get("migrationError")
        if migration_error:
            error_str = str(migration_error)[:200]
            reasons["has_migration_error"].append({
                "id": ext_id,
                "name": name,
                "error": error_str
            })
            error_messages[error_str] += 1
            categorized = True
            continue

        # Check for error in tags
        error_tags = [t for t in tags if "ERROR" in str(t).upper() or "FAIL" in str(t).upper() or "SKIP" in str(t).upper()]
        if error_tags:
            reasons["has_skip_tag"].append({
                "id": ext_id,
                "name": name,
                "tags": error_tags
            })
            for t in error_tags:
                skip_tags[t] += 1
            categorized = True
            continue

        # Check for any error-like fields
        error_fields = []
        for field in ext.keys():
            field_lower = field.lower()
            if any(kw in field_lower for kw in ["error", "fail", "skip", "exception"]):
                val = ext.get(field)
                if val:
                    error_fields.append(f"{field}={str(val)[:100]}")

        if error_fields:
            reasons["has_error_field"].append({
                "id": ext_id,
                "name": name,
                "fields": error_fields
            })
            categorized = True
            continue

        # Unknown reason
        if not categorized:
            # Capture some diagnostic info
            reasons["unknown"].append({
                "id": ext_id,
                "name": name,
                "manifest_version": mv,
                "tags": tags[:5] if tags else [],
                "fields": list(ext.keys())[:10],
            })

    return {
        "summary": {
            "total": total_count,
            "migrated": migrated_count,
            "unmigrated": len(unmigrated),
        },
        "reasons": {k: len(v) for k, v in reasons.items()},
        "details": reasons if verbose else {k: v[:5] for k, v in reasons.items()},
        "all_fields_in_unmigrated": all_fields.most_common(30),
        "tags_in_unmigrated": tag_counts.most_common(20),
        "error_messages": error_messages.most_common(10),
        "skip_tags": skip_tags.most_common(10),
    }


def print_results(results: Dict[str, Any], verbose: bool = False) -> None:
    s = results["summary"]
    print(f"\n{'=' * 70}")
    print(f"UNMIGRATED EXTENSIONS ANALYSIS")
    print(f"{'=' * 70}")
    print(f"Total: {s['total']}  |  Migrated: {s['migrated']}  |  Unmigrated: {s['unmigrated']}")

    print(f"\n--- Reasons for not migrating ---")
    total_explained = 0
    for reason, count in sorted(results["reasons"].items(), key=lambda x: -x[1]):
        if count > 0:
            pct = round(count / max(s["unmigrated"], 1) * 100, 1)
            print(f"  {reason:30s} {count:6d}  ({pct}%)")
            total_explained += count

    print(f"\n  {'TOTAL EXPLAINED':30s} {total_explained:6d}")

    if results["tags_in_unmigrated"]:
        print(f"\n--- Tags present in unmigrated extensions ---")
        for tag, count in results["tags_in_unmigrated"]:
            print(f"  {str(tag):45s} {count:6d}")

    if results["error_messages"]:
        print(f"\n--- Common error messages ---")
        for msg, count in results["error_messages"]:
            print(f"  [{count:3d}x] {msg[:80]}")

    if results["skip_tags"]:
        print(f"\n--- Skip/error tags ---")
        for tag, count in results["skip_tags"]:
            print(f"  {str(tag):45s} {count:6d}")

    if results["all_fields_in_unmigrated"]:
        print(f"\n--- Fields present in unmigrated docs ---")
        for field, count in results["all_fields_in_unmigrated"]:
            print(f"  {field:30s} {count:6d}")

    # Show examples from each category
    print(f"\n--- Examples from each category ---")
    for reason, examples in results["details"].items():
        if examples:
            print(f"\n  {reason} ({len(examples)} shown):")
            for ex in examples[:3]:
                ext_id = ex.get("id", "?")
                name = ex.get("name", "?")
                extra = ""
                if "error" in ex:
                    extra = f" - error: {ex['error'][:60]}..."
                elif "tags" in ex and isinstance(ex["tags"], list):
                    extra = f" - tags: {ex['tags']}"
                elif "fields" in ex and isinstance(ex["fields"], list):
                    extra = f" - fields: {ex['fields'][:5]}"
                print(f"    [{ext_id}] {name[:40]}{extra}")


def main():
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                break

    parser = argparse.ArgumentParser(
        description="Analyze why certain extensions were not migrated."
    )
    parser.add_argument(
        "--uri", type=str, default=os.environ.get("MONGODB_URI", DEFAULT_URI)
    )
    parser.add_argument(
        "--db", type=str, default=os.environ.get("DB_NAME", DEFAULT_DB)
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show all examples instead of just first 5"
    )
    args = parser.parse_args()

    client = connect_to_db(args.uri)
    try:
        results = analyze_unmigrated(client, args.db, args.verbose)
        print_results(results, args.verbose)
    finally:
        client.close()


if __name__ == "__main__":
    main()
