#!/usr/bin/env python3
"""
Download LLM fix attempts from MongoDB and export to CSV.

Combines fix attempt data with extension information (name, interestingness score,
CWS metadata, tags, etc.) for a complete view of LLM-powered extension fixes.

Usage:
    python download_llm_fix_attempts.py [output_csv] [--uri URI] [--success-only] [--include-conversation] [--include-diffs]

Arguments:
    output_csv: Output CSV file path (default: llm_fix_attempts.csv)
    --uri: MongoDB URI (default: mongodb://admin:password@localhost:27017/migrator?authSource=admin)
    --success-only: Only export successful fix attempts
    --include-conversation: Include the full conversation history as a JSON column
    --include-diffs: Include file diffs as a JSON column
    --include-tool-calls: Include tool calls as a JSON column

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
LLM_FIX_ATTEMPTS_COLLECTION = "llm_fix_attempts"
EXTENSIONS_COLLECTION = "extensions"
REPORTS_COLLECTION = "reports"

# Fields to export (in order) - combining fix attempt and extension data
EXPORT_FIELDS = [
    # Fix attempt identification
    "attempt_id",
    "extension_id",
    "report_id",
    # Extension info
    "extension_name",
    "extension_version",
    "interestingness_score",
    "tags",
    # CWS info
    "cws_user_count",
    "cws_rating",
    "cws_developer",
    # Fix attempt timing
    "started_at",
    "completed_at",
    "duration_seconds",
    # Fix attempt result
    "success",
    "message",
    "error",
    # Fix details
    "files_modified",
    "files_modified_count",
    "iterations",
    "tool_calls_count",
    "read_file_count",
    "write_file_count",
    "list_files_count",
    # Report context (if available)
    "report_overall_working",
    "report_installs",
    "report_has_errors",
    "report_notes",
]

# Headers with units for CSV export
FIELD_HEADERS = {
    "duration_seconds": "duration (seconds)",
    "cws_user_count": "cws_user_count (users)",
    "cws_rating": "cws_rating (out of 5)",
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
        # Handle both milliseconds and seconds
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
    """Parse user count string to integer."""
    if not user_count_str:
        return None
    cleaned = re.sub(
        r"[,\s+]", "", user_count_str.lower().replace("users", "").replace("user", "")
    )
    try:
        return int(cleaned)
    except ValueError:
        return None


def parse_rating(rating_str: Optional[str]) -> Optional[float]:
    """Parse rating string to float."""
    if not rating_str:
        return None
    try:
        return float(rating_str)
    except ValueError:
        return None


def get_extensions_map(client: MongoClient, db_name: str) -> Dict[str, Dict]:
    """Fetch all extensions and return a map by ID."""
    db = client[db_name]
    collection = db[EXTENSIONS_COLLECTION]

    projection = {
        "id": 1,
        "name": 1,
        "version": 1,
        "interestingness_score": 1,
        "tags": 1,
        "cws_info": 1,
    }

    extensions = list(collection.find({}, projection))
    print(f"Found {len(extensions)} extensions")

    ext_map = {}
    for ext in extensions:
        ext_id = ext.get("id")
        if ext_id:
            ext_map[ext_id] = ext

    return ext_map


def get_reports_map(client: MongoClient, db_name: str) -> Dict[str, Dict]:
    """Fetch all reports and return a map by ID."""
    db = client[db_name]
    collection = db[REPORTS_COLLECTION]

    projection = {
        "id": 1,
        "extension_id": 1,
        "overall_working": 1,
        "installs": 1,
        "has_errors": 1,
        "notes": 1,
    }

    reports = list(collection.find({}, projection))
    print(f"Found {len(reports)} reports")

    report_map = {}
    for report in reports:
        report_id = report.get("id")
        if report_id:
            report_map[report_id] = report

    return report_map


def get_fix_attempts(
    client: MongoClient, db_name: str, success_only: bool = False
) -> List[Dict]:
    """Fetch all LLM fix attempts from the database."""
    db = client[db_name]
    collection = db[LLM_FIX_ATTEMPTS_COLLECTION]

    query = {}
    if success_only:
        query["success"] = True

    attempts = list(collection.find(query).sort("started_at", -1))
    print(f"Found {len(attempts)} LLM fix attempts")
    return attempts


def count_tool_calls_by_type(tool_calls: List[Dict]) -> Dict[str, int]:
    """Count tool calls by type."""
    counts = {
        "read_file": 0,
        "write_file": 0,
        "list_files": 0,
    }
    for call in tool_calls:
        tool = call.get("tool", "")
        if tool in counts:
            counts[tool] += 1
    return counts


def combine_attempt_with_context(
    attempt: Dict,
    extension: Optional[Dict],
    report: Optional[Dict],
) -> Dict:
    """Combine fix attempt data with extension and report data."""
    combined = {}

    # Fix attempt fields
    combined["attempt_id"] = attempt.get("id")
    combined["extension_id"] = attempt.get("extension_id")
    combined["report_id"] = attempt.get("report_id")
    combined["started_at"] = attempt.get("started_at")
    combined["completed_at"] = attempt.get("completed_at")

    # Duration in seconds
    duration_ms = attempt.get("duration_ms")
    combined["duration_seconds"] = round(duration_ms / 1000, 2) if duration_ms else None

    combined["success"] = attempt.get("success")
    combined["message"] = attempt.get("message")
    combined["error"] = attempt.get("error")
    combined["iterations"] = attempt.get("iterations")

    # Files modified
    files_modified = attempt.get("files_modified", [])
    combined["files_modified"] = files_modified
    combined["files_modified_count"] = len(files_modified)

    # Tool calls analysis
    tool_calls = attempt.get("tool_calls", [])
    combined["tool_calls_count"] = len(tool_calls)
    tool_counts = count_tool_calls_by_type(tool_calls)
    combined["read_file_count"] = tool_counts["read_file"]
    combined["write_file_count"] = tool_counts["write_file"]
    combined["list_files_count"] = tool_counts["list_files"]

    # Keep full data for optional columns
    combined["_conversation"] = attempt.get("conversation", [])
    combined["_tool_calls"] = tool_calls
    combined["_file_diffs"] = attempt.get("file_diffs", [])

    # Extension fields
    if extension:
        combined["extension_name"] = extension.get("name")
        combined["extension_version"] = extension.get("version")
        combined["interestingness_score"] = extension.get("interestingness_score")
        combined["tags"] = extension.get("tags")

        # CWS info
        cws_info = extension.get("cws_info")
        if cws_info:
            details = cws_info.get("details", {})
            combined["cws_user_count"] = parse_user_count(details.get("userCount"))
            combined["cws_rating"] = parse_rating(details.get("rating"))
            combined["cws_developer"] = details.get("developer")
    else:
        # Use name from attempt if extension not found
        combined["extension_name"] = attempt.get("extension_name")

    # Report fields
    if report:
        combined["report_overall_working"] = report.get("overall_working")
        combined["report_installs"] = report.get("installs")
        combined["report_has_errors"] = report.get("has_errors")
        combined["report_notes"] = report.get("notes")

    return combined


def export_to_csv(
    combined_data: List[Dict],
    output_path: Path,
    include_conversation: bool = False,
    include_diffs: bool = False,
    include_tool_calls: bool = False,
) -> None:
    """Export combined data to CSV file."""
    if not combined_data:
        print("No data to export.")
        return

    # Build field list
    fields = EXPORT_FIELDS.copy()
    if include_conversation:
        fields.append("conversation")
    if include_tool_calls:
        fields.append("tool_calls")
    if include_diffs:
        fields.append("file_diffs")

    # Create headers with units where applicable
    headers = [FIELD_HEADERS.get(field, field) for field in fields]

    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)

        for record in combined_data:
            row = []
            for field in fields:
                # Handle optional JSON columns
                if field == "conversation":
                    value = record.get("_conversation", [])
                elif field == "tool_calls":
                    value = record.get("_tool_calls", [])
                elif field == "file_diffs":
                    value = record.get("_file_diffs", [])
                else:
                    value = record.get(field)

                # Format timestamps
                if field in ("started_at", "completed_at"):
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
    success_count = sum(1 for r in combined_data if r.get("success"))
    failure_count = total - success_count

    # Calculate average duration
    durations = [
        r["duration_seconds"]
        for r in combined_data
        if r.get("duration_seconds") is not None
    ]
    avg_duration = sum(durations) / len(durations) if durations else 0.0

    # Calculate average iterations
    iterations = [
        r["iterations"] for r in combined_data if r.get("iterations") is not None
    ]
    avg_iterations = sum(iterations) / len(iterations) if iterations else 0.0

    # Count total files modified
    total_files_modified = sum(r.get("files_modified_count", 0) for r in combined_data)

    # Count tool calls
    total_tool_calls = sum(r.get("tool_calls_count", 0) for r in combined_data)
    total_reads = sum(r.get("read_file_count", 0) for r in combined_data)
    total_writes = sum(r.get("write_file_count", 0) for r in combined_data)

    # Unique extensions
    unique_extensions = len(
        set(r.get("extension_id") for r in combined_data if r.get("extension_id"))
    )

    print(f"\n{'=' * 55}")
    print("LLM Fix Attempts Summary")
    print(f"{'=' * 55}")
    print(f"Total attempts:          {total}")
    print(
        f"Successful:              {success_count} ({100 * success_count / total:.1f}%)"
    )
    print(
        f"Failed:                  {failure_count} ({100 * failure_count / total:.1f}%)"
    )
    print(f"Unique extensions:       {unique_extensions}")
    print(f"{'=' * 55}")
    print(f"Avg duration:            {avg_duration:.1f} seconds")
    print(f"Avg iterations:          {avg_iterations:.1f}")
    print(f"Total files modified:    {total_files_modified}")
    print(f"{'=' * 55}")
    print(f"Total tool calls:        {total_tool_calls}")
    print(f"  - read_file:           {total_reads}")
    print(f"  - write_file:          {total_writes}")


def main():
    parser = argparse.ArgumentParser(
        description="Download LLM fix attempts from MongoDB and export to CSV."
    )
    parser.add_argument(
        "output_csv",
        type=str,
        nargs="?",
        default="llm_fix_attempts.csv",
        help="Output CSV file path (default: llm_fix_attempts.csv)",
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
        "--success-only",
        action="store_true",
        help="Only export successful fix attempts",
    )
    parser.add_argument(
        "--include-conversation",
        action="store_true",
        help="Include full conversation history as a JSON column",
    )
    parser.add_argument(
        "--include-diffs",
        action="store_true",
        help="Include file diffs (before/after) as a JSON column",
    )
    parser.add_argument(
        "--include-tool-calls",
        action="store_true",
        help="Include all tool calls as a JSON column",
    )

    args = parser.parse_args()
    output_path = Path(args.output_csv)

    print("Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        # Fetch extensions for lookup
        print(f"Fetching extensions from '{args.db}.{EXTENSIONS_COLLECTION}'...")
        extensions_map = get_extensions_map(client, args.db)

        # Fetch reports for lookup
        print(f"Fetching reports from '{args.db}.{REPORTS_COLLECTION}'...")
        reports_map = get_reports_map(client, args.db)

        # Fetch LLM fix attempts
        print(
            f"Fetching LLM fix attempts from '{args.db}.{LLM_FIX_ATTEMPTS_COLLECTION}'..."
        )
        attempts = get_fix_attempts(client, args.db, success_only=args.success_only)

        if attempts:
            # Combine with extension and report data
            print("Combining fix attempt data with extension and report info...")
            combined_data = []
            missing_extensions = 0
            missing_reports = 0

            for attempt in attempts:
                ext_id = attempt.get("extension_id", "")
                report_id = attempt.get("report_id", "")

                extension = extensions_map.get(ext_id) if ext_id else None
                report = reports_map.get(report_id) if report_id else None

                if not extension:
                    missing_extensions += 1
                if not report:
                    missing_reports += 1

                combined = combine_attempt_with_context(attempt, extension, report)
                combined_data.append(combined)

            if missing_extensions > 0:
                print(
                    f"Warning: {missing_extensions} attempts have no matching extension"
                )
            if missing_reports > 0:
                print(f"Warning: {missing_reports} attempts have no matching report")

            print_summary(combined_data)
            print("\nExporting to CSV...")
            export_to_csv(
                combined_data,
                output_path,
                include_conversation=args.include_conversation,
                include_diffs=args.include_diffs,
                include_tool_calls=args.include_tool_calls,
            )
        else:
            print("No LLM fix attempts found in the database.")

    finally:
        client.close()
        print("Connection closed.")


if __name__ == "__main__":
    main()
