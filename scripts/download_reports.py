#!/usr/bin/env python3
"""
Download extension reports from MongoDB and export to CSV.

Usage:
    python download_reports.py [output_csv] [--uri URI] [--tested-only] [--include-listeners]

Arguments:
    output_csv: Output CSV file path (default: extension_reports.csv)
    --uri: MongoDB URI (default: mongodb://admin:password@localhost:27017/migrator?authSource=admin)
    --tested-only: Only export reports that have been tested
    --include-listeners: Include per-listener test results as a JSON column

Requirements:
    pip install pymongo
"""

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"
REPORTS_COLLECTION = "reports"

# Fields to export (in order)
REPORT_FIELDS = [
    "id",
    "extension_id",
    "tested",
    "created_at",
    "updated_at",
    "verification_duration_secs",
    "overall_working",
    "has_errors",
    "seems_slower",
    "needs_login",
    "is_popup_broken",
    "is_settings_broken",
    "is_interesting",
    "notes",
]


def connect_to_db(uri: str) -> MongoClient:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Test the connection
        client.admin.command("ping")
        print(f"Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def format_timestamp(ts: Optional[float]) -> str:
    """Convert Unix timestamp to ISO format string."""
    if ts is None:
        return ""
    try:
        return datetime.fromtimestamp(ts / 1000 if ts > 1e12 else ts).isoformat()
    except (ValueError, OSError):
        return str(ts)


def format_value(value: Any) -> str:
    """Format a value for CSV output."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (list, dict)):
        return json.dumps(value)
    return str(value)


def get_reports(
    client: MongoClient, db_name: str, tested_only: bool = False
) -> List[Dict]:
    """Fetch all reports from the database."""
    db = client[db_name]
    collection = db[REPORTS_COLLECTION]

    query = {}
    if tested_only:
        query["tested"] = True

    reports = list(collection.find(query))
    print(f"Found {len(reports)} reports")
    return reports


def export_to_csv(
    reports: List[Dict], output_path: Path, include_listeners: bool = False
) -> None:
    """Export reports to CSV file."""
    if not reports:
        print("No reports to export.")
        return

    # Determine all fields present in reports
    fields = REPORT_FIELDS.copy()
    if include_listeners:
        fields.append("listeners")

    # Collect any additional fields not in the standard list
    extra_fields = set()
    for report in reports:
        for key in report.keys():
            if key not in fields and key != "_id":
                extra_fields.add(key)

    # Add extra fields sorted alphabetically
    fields.extend(sorted(extra_fields))

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        # Write header
        writer.writerow(fields)

        # Write data rows
        for report in reports:
            row = []
            for field in fields:
                value = report.get(field)

                # Format timestamps
                if field in ("created_at", "updated_at"):
                    row.append(format_timestamp(value))
                else:
                    row.append(format_value(value))

            writer.writerow(row)

    print(f"Exported {len(reports)} reports to: {output_path}")


def print_summary(reports: List[Dict]) -> None:
    """Print a summary of the reports."""
    if not reports:
        return

    tested_count = sum(1 for r in reports if r.get("tested"))
    working_count = sum(1 for r in reports if r.get("overall_working") is True)
    has_errors_count = sum(1 for r in reports if r.get("has_errors") is True)
    interesting_count = sum(1 for r in reports if r.get("is_interesting") is True)

    print(f"\n{'=' * 50}")
    print("Summary")
    print(f"{'=' * 50}")
    print(f"Total reports:    {len(reports)}")
    print(f"Tested:           {tested_count}")
    print(f"Overall working:  {working_count}")
    print(f"Has errors:       {has_errors_count}")
    print(f"Interesting:      {interesting_count}")


def main():
    parser = argparse.ArgumentParser(
        description="Download extension reports from MongoDB and export to CSV."
    )
    parser.add_argument(
        "output_csv",
        type=str,
        nargs="?",
        default="extension_reports.csv",
        help="Output CSV file path (default: extension_reports.csv)",
    )
    parser.add_argument(
        "--uri",
        type=str,
        default=DEFAULT_URI,
        help=f"MongoDB URI (default: {DEFAULT_URI})",
    )
    parser.add_argument(
        "--db",
        type=str,
        default=DEFAULT_DB,
        help=f"Database name (default: {DEFAULT_DB})",
    )
    parser.add_argument(
        "--tested-only",
        action="store_true",
        help="Only export reports that have been tested",
    )
    parser.add_argument(
        "--include-listeners",
        action="store_true",
        help="Include per-listener test results as a JSON column",
    )

    args = parser.parse_args()
    output_path = Path(args.output_csv)

    print(f"Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        print(f"Fetching reports from '{args.db}.{REPORTS_COLLECTION}'...")
        reports = get_reports(client, args.db, tested_only=args.tested_only)

        if reports:
            print_summary(reports)
            print(f"\nExporting to CSV...")
            export_to_csv(
                reports, output_path, include_listeners=args.include_listeners
            )
        else:
            print("No reports found in the database.")

    finally:
        client.close()
        print("Connection closed.")


if __name__ == "__main__":
    main()
