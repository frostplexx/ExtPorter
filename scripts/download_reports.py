#!/usr/bin/env python3
"""
Download extension reports from MongoDB and export to CSV.

Combines report data with extension information (name, interestingness score,
CWS metadata, tags, etc.) for a complete view.

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
import re
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
EXTENSIONS_COLLECTION = "extensions"

# Fields to export (in order) - combining report and extension data
# Extension fields are prefixed for clarity
EXPORT_FIELDS = [
    # Report identification
    "report_id",
    "extension_id",
    # Extension info
    "extension_name",
    "extension_version",
    "interestingness_score",
    "tags",
    # CWS info
    "cws_user_count",
    "cws_rating",
    "cws_rating_count",
    "cws_developer",
    "cws_size_bytes",
    "cws_updated",
    "cws_description",
    # Report status
    "tested",
    "created_at",
    "updated_at",
    "verification_duration_secs",
    # Report assessment
    "installs",
    "works_in_mv2",
    "overall_working",
    "has_errors",
    "seems_slower",
    "needs_login",
    "is_popup_working",
    "is_settings_working",
    "is_new_tab_working",
    "is_interesting",
    "notes",
    # Extension details
    "is_new_tab_extension",
    "event_listeners_count",
    "interestingness_breakdown",
]

# Headers with units for CSV export
FIELD_HEADERS = {
    "cws_user_count": "cws_user_count (users)",
    "cws_rating": "cws_rating (out of 5)",
    "cws_rating_count": "cws_rating_count (ratings)",
    "cws_size_bytes": "cws_size (bytes)",
    "verification_duration_secs": "verification_duration (seconds)",
}


def connect_to_db(uri: str) -> MongoClient:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Test the connection
        client.admin.command("ping")
        print("Connected to MongoDB")
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


def parse_user_count(user_count_str: Optional[str]) -> Optional[int]:
    """
    Parse user count string to integer.
    Examples: "2,000 users" -> 2000, "5,000,000+ users" -> 5000000
    """
    if not user_count_str:
        return None
    # Remove "users", "+", commas, and whitespace
    cleaned = re.sub(
        r"[,\s+]", "", user_count_str.lower().replace("users", "").replace("user", "")
    )
    try:
        return int(cleaned)
    except ValueError:
        return None


def parse_rating(rating_str: Optional[str]) -> Optional[float]:
    """
    Parse rating string to float.
    Examples: "4.5" -> 4.5
    """
    if not rating_str:
        return None
    try:
        return float(rating_str)
    except ValueError:
        return None


def parse_rating_count(rating_count_str: Optional[str]) -> Optional[int]:
    """
    Parse rating count string to integer.
    Examples: "250" -> 250, "1,234" -> 1234
    """
    if not rating_count_str:
        return None
    cleaned = re.sub(r"[,\s]", "", rating_count_str)
    try:
        return int(cleaned)
    except ValueError:
        return None


def parse_size_to_bytes(size_str: Optional[str]) -> Optional[int]:
    """
    Parse size string to bytes.
    Examples: "37.66KiB" -> 38563, "1.5MiB" -> 1572864, "500B" -> 500
    """
    if not size_str:
        return None

    size_str = size_str.strip().upper()

    # Match patterns like "37.66KIB", "1.5MIB", "500B"
    match = re.match(r"^([\d.]+)\s*(B|KB|KIB|MB|MIB|GB|GIB)?$", size_str)
    if not match:
        return None

    try:
        value = float(match.group(1))
        unit = match.group(2) or "B"

        multipliers = {
            "B": 1,
            "KB": 1000,
            "KIB": 1024,
            "MB": 1000 * 1000,
            "MIB": 1024 * 1024,
            "GB": 1000 * 1000 * 1000,
            "GIB": 1024 * 1024 * 1024,
        }

        return int(value * multipliers.get(unit, 1))
    except (ValueError, TypeError):
        return None


def get_extensions_map(client: MongoClient, db_name: str) -> Dict[str, Dict]:
    """Fetch all extensions and return a map by ID."""
    db = client[db_name]
    collection = db[EXTENSIONS_COLLECTION]

    # Project only the fields we need to reduce memory usage
    projection = {
        "id": 1,
        "name": 1,
        "version": 1,
        "interestingness_score": 1,
        "interestingness_breakdown": 1,
        "tags": 1,
        "isNewTabExtension": 1,
        "event_listeners": 1,
        "cws_info": 1,
    }

    extensions = list(collection.find({}, projection))
    print(f"Found {len(extensions)} extensions")

    # Build a map by extension ID
    ext_map = {}
    for ext in extensions:
        ext_id = ext.get("id")
        if ext_id:
            ext_map[ext_id] = ext

    return ext_map


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


def combine_report_with_extension(report: Dict, extension: Optional[Dict]) -> Dict:
    """Combine report data with extension data into a single record."""
    combined = {}

    # Report fields
    combined["report_id"] = report.get("id")
    combined["extension_id"] = report.get("extension_id")
    combined["tested"] = report.get("tested")
    combined["created_at"] = report.get("created_at")
    combined["updated_at"] = report.get("updated_at")
    combined["verification_duration_secs"] = report.get("verification_duration_secs")
    combined["installs"] = report.get("installs")
    combined["works_in_mv2"] = report.get("works_in_mv2")
    combined["overall_working"] = report.get("overall_working")
    combined["has_errors"] = report.get("has_errors")
    combined["seems_slower"] = report.get("seems_slower")
    combined["needs_login"] = report.get("needs_login")
    combined["is_popup_working"] = report.get("is_popup_working")
    combined["is_settings_working"] = report.get("is_settings_working")
    combined["is_new_tab_working"] = report.get("is_new_tab_working")
    combined["is_interesting"] = report.get("is_interesting")
    combined["notes"] = report.get("notes")
    combined["listeners"] = report.get("listeners")

    # Extension fields
    if extension:
        combined["extension_name"] = extension.get("name")
        combined["extension_version"] = extension.get("version")
        combined["interestingness_score"] = extension.get("interestingness_score")
        combined["interestingness_breakdown"] = extension.get(
            "interestingness_breakdown"
        )
        combined["tags"] = extension.get("tags")
        combined["is_new_tab_extension"] = extension.get("isNewTabExtension")

        # Count event listeners
        event_listeners = extension.get("event_listeners")
        if event_listeners:
            combined["event_listeners_count"] = len(event_listeners)

        # CWS info - parse to dimensionless values
        cws_info = extension.get("cws_info")
        if cws_info:
            details = cws_info.get("details", {})
            combined["cws_user_count"] = parse_user_count(details.get("userCount"))
            combined["cws_rating"] = parse_rating(details.get("rating"))
            combined["cws_rating_count"] = parse_rating_count(
                details.get("ratingCount")
            )
            combined["cws_developer"] = details.get("developer")
            combined["cws_size_bytes"] = parse_size_to_bytes(details.get("size"))
            combined["cws_updated"] = details.get("updated")
            combined["cws_description"] = cws_info.get("description")

    return combined


def export_to_csv(
    combined_data: List[Dict], output_path: Path, include_listeners: bool = False
) -> None:
    """Export combined report/extension data to CSV file."""
    if not combined_data:
        print("No data to export.")
        return

    # Determine all fields present
    fields = EXPORT_FIELDS.copy()
    if include_listeners:
        fields.append("listeners")

    # Collect any additional fields not in the standard list
    extra_fields = set()
    for record in combined_data:
        for key in record.keys():
            if key not in fields and key != "_id" and key != "listeners":
                extra_fields.add(key)

    # Add extra fields sorted alphabetically
    fields.extend(sorted(extra_fields))

    # Create headers with units where applicable
    headers = [FIELD_HEADERS.get(field, field) for field in fields]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)

        # Write header with units
        writer.writerow(headers)

        # Write data rows
        for record in combined_data:
            row = []
            for field in fields:
                value = record.get(field)

                # Format timestamps
                if field in ("created_at", "updated_at"):
                    row.append(format_timestamp(value))
                else:
                    row.append(format_value(value))

            writer.writerow(row)

    print(f"Exported {len(combined_data)} records to: {output_path}")


def print_summary(combined_data: List[Dict]) -> None:
    """Print a summary of the data."""
    if not combined_data:
        return

    total = len(combined_data)
    tested_count = sum(1 for r in combined_data if r.get("tested"))
    working_count = sum(1 for r in combined_data if r.get("overall_working") is True)
    has_errors_count = sum(1 for r in combined_data if r.get("has_errors") is True)
    interesting_count = sum(1 for r in combined_data if r.get("is_interesting") is True)
    with_cws_count = sum(1 for r in combined_data if r.get("cws_user_count"))

    # Calculate average interestingness score
    scores = [
        r["interestingness_score"]
        for r in combined_data
        if r.get("interestingness_score") is not None
    ]
    avg_score = sum(scores) / len(scores) if scores else 0.0

    print(f"\n{'=' * 55}")
    print("Summary")
    print(f"{'=' * 55}")
    print(f"Total reports:           {total}")
    print(f"Tested:                  {tested_count}")
    print(f"Overall working:         {working_count}")
    print(f"Has errors:              {has_errors_count}")
    print(f"Marked interesting:      {interesting_count}")
    print(f"With CWS metadata:       {with_cws_count}")
    print(f"Avg interestingness:     {avg_score:.2f}")


def main():
    parser = argparse.ArgumentParser(
        description="Download extension reports from MongoDB and export to CSV (with extension info)."
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

    print("Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        # Fetch extensions first to build lookup map
        print(f"Fetching extensions from '{args.db}.{EXTENSIONS_COLLECTION}'...")
        extensions_map = get_extensions_map(client, args.db)

        # Fetch reports
        print(f"Fetching reports from '{args.db}.{REPORTS_COLLECTION}'...")
        reports = get_reports(client, args.db, tested_only=args.tested_only)

        if reports:
            # Combine reports with extension data
            print("Combining report and extension data...")
            combined_data = []
            missing_extensions = 0

            for report in reports:
                ext_id = report.get("extension_id", "")
                extension = extensions_map.get(ext_id) if ext_id else None

                if not extension:
                    missing_extensions += 1

                combined = combine_report_with_extension(report, extension)
                combined_data.append(combined)

            if missing_extensions > 0:
                print(
                    f"Warning: {missing_extensions} reports have no matching extension"
                )

            print_summary(combined_data)
            print("\nExporting to CSV...")
            export_to_csv(
                combined_data, output_path, include_listeners=args.include_listeners
            )
        else:
            print("No reports found in the database.")

    finally:
        client.close()
        print("Connection closed.")


if __name__ == "__main__":
    main()
