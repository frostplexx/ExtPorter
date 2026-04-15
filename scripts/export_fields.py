#!/usr/bin/env python3
"""
Export specific fields from reports to CSV for merging with existing spreadsheet.

Usage:
    python export_fields.py [output_csv] [--fields field1,field2,...] [--uri URI]

Example:
    python export_fields.py new_fields.csv --fields installs,works_in_mv2
"""

import argparse
import csv
import sys
from typing import Dict, List

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"
REPORTS_COLLECTION = "reports"


def connect_to_db(uri: str) -> MongoClient:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def format_value(value) -> str:
    """Format a value for CSV output."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def get_reports(client: MongoClient, db_name: str) -> List[Dict]:
    """Fetch all reports from the database."""
    db = client[db_name]
    collection = db[REPORTS_COLLECTION]
    reports = list(collection.find({}))
    print(f"Found {len(reports)} reports")
    return reports


def main():
    parser = argparse.ArgumentParser(
        description="Export specific fields from reports to CSV."
    )
    parser.add_argument(
        "output_csv",
        type=str,
        nargs="?",
        default="new_fields.csv",
        help="Output CSV file path (default: new_fields.csv)",
    )
    parser.add_argument(
        "--fields",
        type=str,
        default="installs,works_in_mv2",
        help="Comma-separated list of fields to export (default: installs,works_in_mv2)",
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

    args = parser.parse_args()
    fields = [f.strip() for f in args.fields.split(",")]

    print(f"Exporting fields: {fields}")
    print("Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        reports = get_reports(client, args.db)

        # Always include extension_id as the key for matching
        export_fields = ["extension_id"] + fields

        with open(args.output_csv, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(export_fields)

            for report in reports:
                row = [format_value(report.get(field)) for field in export_fields]
                writer.writerow(row)

        print(f"Exported {len(reports)} rows to: {args.output_csv}")
        print(f"\nTo merge with your Numbers spreadsheet:")
        print(f"1. Open {args.output_csv} in Numbers")
        print(f"2. Select and copy the '{fields[0]}' column (without header)")
        print(f"3. In your existing spreadsheet, add a new column '{fields[0]}'")
        print(f"4. Match rows by extension_id and paste the values")
        print(f"5. Repeat for other fields")

    finally:
        client.close()


if __name__ == "__main__":
    main()
