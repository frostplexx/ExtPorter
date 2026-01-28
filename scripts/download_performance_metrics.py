#!/usr/bin/env python3
"""
Script to download and analyze performance metrics from ExtPorter's MongoDB database.

Metrics collected:
- Migration timing statistics
- LLM fix attempt durations and success rates
- Fakeium validation performance
- Memory usage from logs
- Extension complexity (interestingness scores)
- Per-extension timing breakdown

Usage:
    python scripts/download_performance_metrics.py [--json] [--output=<file>] [--detailed]

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    from pymongo import MongoClient
    from dotenv import load_dotenv
except ImportError:
    print("Missing dependencies. Install with:")
    print("  pip install pymongo python-dotenv")
    sys.exit(1)


@dataclass
class MigrationMetrics:
    total_extensions: int = 0
    migrated_extensions: int = 0
    failed_extensions: int = 0
    migration_success_rate: float = 0.0


@dataclass
class LLMMetrics:
    total_attempts: int = 0
    successful_attempts: int = 0
    failed_attempts: int = 0
    success_rate: float = 0.0
    avg_duration_ms: int = 0
    min_duration_ms: int = 0
    max_duration_ms: int = 0
    avg_iterations: float = 0.0
    total_files_modified: int = 0


@dataclass
class ValidationMetrics:
    total_validated: int = 0
    equivalent_count: int = 0
    non_equivalent_count: int = 0
    avg_similarity_score: float = 0.0
    avg_validation_duration_ms: int = 0
    avg_mv2_api_calls: float = 0.0
    avg_mv3_api_calls: float = 0.0


@dataclass
class MemoryMetrics:
    samples: int = 0
    avg_heap_used_mb: float = 0.0
    max_heap_used_mb: float = 0.0
    avg_rss_mb: float = 0.0
    max_rss_mb: float = 0.0
    gc_trigger_count: int = 0


@dataclass
class InterestingnessBreakdown:
    web_request: float = 0.0
    html_lines: float = 0.0
    storage_local: float = 0.0
    background_page: float = 0.0
    content_scripts: float = 0.0
    dangerous_permissions: float = 0.0
    host_permissions: float = 0.0
    crypto_patterns: float = 0.0
    network_requests: float = 0.0
    extension_size: float = 0.0
    api_renames: float = 0.0
    manifest_changes: float = 0.0
    file_modifications: float = 0.0
    web_request_to_dnr_migrations: float = 0.0


@dataclass
class ScoreDistributionBucket:
    range: str
    count: int


@dataclass
class InterestingnessMetrics:
    avg_score: float = 0.0
    min_score: float = 0.0
    max_score: float = 0.0
    median_score: float = 0.0
    score_distribution: list = field(default_factory=list)
    avg_breakdown: InterestingnessBreakdown = field(default_factory=InterestingnessBreakdown)


@dataclass
class ExtensionTiming:
    id: str
    name: str
    duration_ms: int


@dataclass
class LogTimingMetrics:
    migration_start_time: Optional[int] = None
    migration_end_time: Optional[int] = None
    total_migration_duration_ms: Optional[int] = None
    avg_time_per_extension_ms: Optional[int] = None
    extension_processing_times: list = field(default_factory=list)


@dataclass
class ReportMetrics:
    total_reports: int = 0
    tested_count: int = 0
    working_count: int = 0
    has_errors_count: int = 0
    slower_count: int = 0
    avg_verification_duration_secs: float = 0.0


@dataclass
class PerformanceReport:
    generated_at: str = ""
    migration: MigrationMetrics = field(default_factory=MigrationMetrics)
    llm_fixes: LLMMetrics = field(default_factory=LLMMetrics)
    validation: ValidationMetrics = field(default_factory=ValidationMetrics)
    memory: MemoryMetrics = field(default_factory=MemoryMetrics)
    interestingness: InterestingnessMetrics = field(default_factory=InterestingnessMetrics)
    timing: LogTimingMetrics = field(default_factory=LogTimingMetrics)
    reports: ReportMetrics = field(default_factory=ReportMetrics)


def connect_to_database():
    """Connect to MongoDB using environment variables."""
    load_dotenv()

    uri = os.getenv("MONGODB_URI")
    db_name = os.getenv("DB_NAME")

    if not uri:
        raise ValueError("MONGODB_URI not found in environment. Set it in .env file.")
    if not db_name:
        raise ValueError("DB_NAME not found in environment. Set it in .env file.")

    client = MongoClient(uri)
    db = client[db_name]

    print(f"Connected to MongoDB database: {db_name}")
    return client, db


def get_migration_metrics(db) -> MigrationMetrics:
    """Get migration statistics."""
    extensions = db.extensions

    total = extensions.count_documents({})
    migrated = extensions.count_documents({"manifest_v3_path": {"$exists": True, "$ne": None}})
    failed = total - migrated

    return MigrationMetrics(
        total_extensions=total,
        migrated_extensions=migrated,
        failed_extensions=failed,
        migration_success_rate=round((migrated / total) * 100, 1) if total > 0 else 0.0
    )


def get_llm_metrics(db) -> LLMMetrics:
    """Get LLM fix attempt statistics."""
    llm_attempts = db.llm_fix_attempts

    total = llm_attempts.count_documents({})
    if total == 0:
        return LLMMetrics()

    successful = llm_attempts.count_documents({"success": True})

    pipeline = [
        {
            "$group": {
                "_id": None,
                "avg_duration": {"$avg": "$duration_ms"},
                "min_duration": {"$min": "$duration_ms"},
                "max_duration": {"$max": "$duration_ms"},
                "avg_iterations": {"$avg": "$iterations"},
                "total_files": {"$sum": {"$size": {"$ifNull": ["$files_modified", []]}}}
            }
        }
    ]

    stats = list(llm_attempts.aggregate(pipeline))
    s = stats[0] if stats else {}

    return LLMMetrics(
        total_attempts=total,
        successful_attempts=successful,
        failed_attempts=total - successful,
        success_rate=round((successful / total) * 100, 1),
        avg_duration_ms=round(s.get("avg_duration", 0) or 0),
        min_duration_ms=round(s.get("min_duration", 0) or 0),
        max_duration_ms=round(s.get("max_duration", 0) or 0),
        avg_iterations=round((s.get("avg_iterations", 0) or 0) * 10) / 10,
        total_files_modified=s.get("total_files", 0) or 0
    )


def get_validation_metrics(db) -> ValidationMetrics:
    """Get Fakeium validation statistics."""
    extensions = db.extensions

    validated = extensions.count_documents({"fakeium_validation.enabled": True})
    if validated == 0:
        return ValidationMetrics()

    equivalent = extensions.count_documents({"fakeium_validation.is_equivalent": True})

    pipeline = [
        {"$match": {"fakeium_validation.enabled": True}},
        {
            "$group": {
                "_id": None,
                "avg_similarity": {"$avg": "$fakeium_validation.similarity_score"},
                "avg_duration": {"$avg": "$fakeium_validation.duration_ms"},
                "avg_mv2_calls": {"$avg": "$fakeium_validation.mv2_api_calls"},
                "avg_mv3_calls": {"$avg": "$fakeium_validation.mv3_api_calls"}
            }
        }
    ]

    stats = list(extensions.aggregate(pipeline))
    s = stats[0] if stats else {}

    return ValidationMetrics(
        total_validated=validated,
        equivalent_count=equivalent,
        non_equivalent_count=validated - equivalent,
        avg_similarity_score=round((s.get("avg_similarity", 0) or 0) * 1000) / 1000,
        avg_validation_duration_ms=round(s.get("avg_duration", 0) or 0),
        avg_mv2_api_calls=round((s.get("avg_mv2_calls", 0) or 0) * 10) / 10,
        avg_mv3_api_calls=round((s.get("avg_mv3_calls", 0) or 0) * 10) / 10
    )


def get_memory_metrics(db) -> MemoryMetrics:
    """Get memory usage statistics from logs."""
    logs = db.logs

    memory_logs = list(logs.find({
        "$or": [
            {"message": {"$regex": "memory", "$options": "i"}},
            {"meta.heapUsedMB": {"$exists": True}},
            {"meta.memory": {"$exists": True}}
        ]
    }))

    heap_samples = []
    rss_samples = []
    gc_count = 0

    for log in memory_logs:
        msg = (log.get("message") or "").lower()
        if "garbage collection" in msg or "gc triggered" in msg:
            gc_count += 1

        meta = log.get("meta", {}) or {}
        if meta.get("heapUsedMB"):
            heap_samples.append(meta["heapUsedMB"])
        if meta.get("rssMB"):
            rss_samples.append(meta["rssMB"])
        if meta.get("memory", {}).get("heapUsedMB"):
            heap_samples.append(meta["memory"]["heapUsedMB"])
        if meta.get("memory", {}).get("rssMB"):
            rss_samples.append(meta["memory"]["rssMB"])

    def avg(arr):
        return sum(arr) / len(arr) if arr else 0

    return MemoryMetrics(
        samples=len(heap_samples),
        avg_heap_used_mb=round(avg(heap_samples) * 10) / 10,
        max_heap_used_mb=round(max(heap_samples) * 10) / 10 if heap_samples else 0,
        avg_rss_mb=round(avg(rss_samples) * 10) / 10,
        max_rss_mb=round(max(rss_samples) * 10) / 10 if rss_samples else 0,
        gc_trigger_count=gc_count
    )


def get_interestingness_metrics(db) -> InterestingnessMetrics:
    """Get extension complexity/interestingness statistics."""
    extensions = db.extensions

    with_scores = list(extensions.find(
        {"interestingness_score": {"$exists": True, "$ne": None}},
        {"interestingness_score": 1, "interestingness_breakdown": 1}
    ))

    if not with_scores:
        return InterestingnessMetrics()

    scores = sorted([e["interestingness_score"] for e in with_scores])
    median = scores[len(scores) // 2]

    # Score distribution
    ranges = [
        (0, 10, "0-10"),
        (10, 25, "10-25"),
        (25, 50, "25-50"),
        (50, 100, "50-100"),
        (100, float("inf"), "100+")
    ]

    distribution = []
    for min_val, max_val, label in ranges:
        count = len([s for s in scores if min_val <= s < max_val])
        distribution.append({"range": label, "count": count})

    # Average breakdown
    breakdown_keys = [
        ("webRequest", "web_request"),
        ("html_lines", "html_lines"),
        ("storage_local", "storage_local"),
        ("background_page", "background_page"),
        ("content_scripts", "content_scripts"),
        ("dangerous_permissions", "dangerous_permissions"),
        ("host_permissions", "host_permissions"),
        ("crypto_patterns", "crypto_patterns"),
        ("network_requests", "network_requests"),
        ("extension_size", "extension_size"),
        ("api_renames", "api_renames"),
        ("manifest_changes", "manifest_changes"),
        ("file_modifications", "file_modifications"),
        ("webRequest_to_dnr_migrations", "web_request_to_dnr_migrations")
    ]

    avg_breakdown = {}
    for db_key, py_key in breakdown_keys:
        values = [
            e["interestingness_breakdown"].get(db_key, 0)
            for e in with_scores
            if e.get("interestingness_breakdown", {}).get(db_key) is not None
        ]
        avg_breakdown[py_key] = round(sum(values) / len(values) * 100) / 100 if values else 0

    return InterestingnessMetrics(
        avg_score=round(sum(scores) / len(scores) * 10) / 10,
        min_score=scores[0],
        max_score=scores[-1],
        median_score=median,
        score_distribution=distribution,
        avg_breakdown=InterestingnessBreakdown(**avg_breakdown)
    )


def get_log_timing_metrics(db, detailed: bool) -> LogTimingMetrics:
    """Get migration timing statistics from logs.

    Calculates timing by identifying migration sessions (batches of logs
    within a time window) rather than using first/last log per extension.
    """
    logs = db.logs

    # Find migration session markers - progress logs indicate active migration
    progress_logs = list(logs.find({
        "$or": [
            {"message": {"$regex": "progress.*extension", "$options": "i"}},
            {"message": {"$regex": "GC after.*extensions", "$options": "i"}},
            {"message": {"$regex": "starting migration", "$options": "i"}},
            {"message": {"$regex": "migration complete", "$options": "i"}},
            {"message": {"$regex": "extensions processed", "$options": "i"}}
        ]
    }).sort("time", 1))

    if not progress_logs:
        return LogTimingMetrics()

    # Identify migration sessions by finding time gaps > 1 hour
    SESSION_GAP_MS = 3600000  # 1 hour gap indicates new session

    sessions = []
    current_session = {"start": progress_logs[0]["time"], "end": progress_logs[0]["time"], "count": 0}

    for i, log in enumerate(progress_logs):
        time = log["time"]
        msg = (log.get("message") or "").lower()

        # Check if this is a new session
        if time - current_session["end"] > SESSION_GAP_MS:
            if current_session["count"] > 0:
                sessions.append(current_session)
            current_session = {"start": time, "end": time, "count": 0}

        current_session["end"] = time

        # Try to extract extension count from progress messages
        # Match patterns like "Progress: 100 new + 50 skipped = 150/1000"
        # or "GC after 100 extensions"
        count_match = re.search(r'(\d+)\s*(?:new|extensions)', msg)
        if count_match:
            count = int(count_match.group(1))
            current_session["count"] = max(current_session["count"], count)

    # Don't forget last session
    if current_session["count"] > 0:
        sessions.append(current_session)

    if not sessions:
        return LogTimingMetrics()

    # Calculate totals across all sessions
    total_duration = sum(s["end"] - s["start"] for s in sessions)
    total_extensions = sum(s["count"] for s in sessions)

    avg_time = None
    if total_extensions > 0:
        avg_time = round(total_duration / total_extensions)

    # Get per-extension timing by analyzing log sequences within sessions
    # Look for consecutive logs for the same extension within a short window
    extension_times = []

    if detailed:
        # Get extensions with multiple log entries in quick succession
        pipeline = [
            {"$match": {"extension.id": {"$exists": True}}},
            {"$sort": {"time": 1}},
            {
                "$group": {
                    "_id": "$extension.id",
                    "name": {"$first": "$extension.name"},
                    "times": {"$push": "$time"},
                    "count": {"$sum": 1}
                }
            },
            {"$match": {"count": {"$gte": 2}}},
            {"$limit": 200}
        ]

        ext_logs = list(logs.aggregate(pipeline))

        for ext in ext_logs:
            times = sorted(ext["times"])
            # Find the shortest gap between consecutive logs (processing time)
            # Filter to gaps under 5 minutes (actual processing, not session spans)
            gaps = []
            for i in range(len(times) - 1):
                gap = times[i + 1] - times[i]
                if 0 < gap < 300000:  # Under 5 minutes
                    gaps.append(gap)

            if gaps:
                # Use median gap as representative processing time
                gaps.sort()
                median_gap = gaps[len(gaps) // 2]
                extension_times.append({
                    "id": ext["_id"],
                    "name": ext.get("name") or "Unknown",
                    "duration_ms": median_gap
                })

        # Sort by duration descending
        extension_times.sort(key=lambda x: x["duration_ms"], reverse=True)
        extension_times = extension_times[:10]

    # Get the most recent session for display
    latest_session = sessions[-1] if sessions else None

    return LogTimingMetrics(
        migration_start_time=sessions[0]["start"] if sessions else None,
        migration_end_time=sessions[-1]["end"] if sessions else None,
        total_migration_duration_ms=total_duration if total_duration > 0 else None,
        avg_time_per_extension_ms=avg_time,
        extension_processing_times=extension_times
    )


def get_report_metrics(db) -> ReportMetrics:
    """Get manual testing report statistics."""
    reports = db.reports

    total = reports.count_documents({})
    if total == 0:
        return ReportMetrics()

    tested = reports.count_documents({"tested": True})
    working = reports.count_documents({"overall_working": True})
    has_errors = reports.count_documents({"has_errors": True})
    slower = reports.count_documents({"seems_slower": True})

    pipeline = [
        {"$match": {"verification_duration_secs": {"$exists": True, "$gt": 0}}},
        {"$group": {"_id": None, "avg_duration": {"$avg": "$verification_duration_secs"}}}
    ]

    stats = list(reports.aggregate(pipeline))
    avg_duration = stats[0].get("avg_duration", 0) if stats else 0

    return ReportMetrics(
        total_reports=total,
        tested_count=tested,
        working_count=working,
        has_errors_count=has_errors,
        slower_count=slower,
        avg_verification_duration_secs=round(avg_duration * 10) / 10
    )


def format_duration(ms: int) -> str:
    """Format milliseconds as human-readable duration."""
    if ms < 1000:
        return f"{ms}ms"
    if ms < 60000:
        return f"{ms / 1000:.1f}s"
    if ms < 3600000:
        return f"{ms / 60000:.1f}m"
    return f"{ms / 3600000:.2f}h"


def print_report(report: PerformanceReport, detailed: bool):
    """Print the performance report to console."""
    print("\n" + "=" * 80)
    print("EXTPORTER PERFORMANCE METRICS REPORT")
    print("=" * 80)
    print(f"Generated: {report.generated_at}\n")

    # Migration Statistics
    print("-" * 40)
    print("MIGRATION STATISTICS")
    print("-" * 40)
    m = report.migration
    print(f"Total Extensions:      {m.total_extensions}")
    print(f"Migrated:              {m.migrated_extensions}")
    print(f"Failed:                {m.failed_extensions}")
    print(f"Success Rate:          {m.migration_success_rate:.1f}%")

    # Timing
    print("\n" + "-" * 40)
    print("TIMING METRICS")
    print("-" * 40)
    t = report.timing
    if t.total_migration_duration_ms:
        print(f"Total Migration Time:  {format_duration(t.total_migration_duration_ms)}")
    if t.avg_time_per_extension_ms:
        print(f"Avg Time/Extension:    {format_duration(t.avg_time_per_extension_ms)}")
    if t.extension_processing_times:
        print("\nTop Extensions by Processing Time:")
        for ext in t.extension_processing_times[:5]:
            name = ext["name"][:40].ljust(40)
            print(f"  - {name} {format_duration(ext['duration_ms'])}")

    # LLM Fix Metrics
    print("\n" + "-" * 40)
    print("LLM FIX ATTEMPTS")
    print("-" * 40)
    l = report.llm_fixes
    print(f"Total Attempts:        {l.total_attempts}")
    print(f"Successful:            {l.successful_attempts}")
    print(f"Failed:                {l.failed_attempts}")
    print(f"Success Rate:          {l.success_rate:.1f}%")
    print(f"Avg Duration:          {format_duration(l.avg_duration_ms)}")
    print(f"Min Duration:          {format_duration(l.min_duration_ms)}")
    print(f"Max Duration:          {format_duration(l.max_duration_ms)}")
    print(f"Avg Iterations:        {l.avg_iterations}")
    print(f"Total Files Modified:  {l.total_files_modified}")

    # Validation Metrics
    print("\n" + "-" * 40)
    print("FAKEIUM VALIDATION")
    print("-" * 40)
    v = report.validation
    print(f"Total Validated:       {v.total_validated}")
    print(f"Equivalent:            {v.equivalent_count}")
    print(f"Non-Equivalent:        {v.non_equivalent_count}")
    print(f"Avg Similarity Score:  {v.avg_similarity_score}")
    print(f"Avg Validation Time:   {format_duration(v.avg_validation_duration_ms)}")
    print(f"Avg MV2 API Calls:     {v.avg_mv2_api_calls}")
    print(f"Avg MV3 API Calls:     {v.avg_mv3_api_calls}")

    # Memory Metrics
    print("\n" + "-" * 40)
    print("MEMORY USAGE")
    print("-" * 40)
    mem = report.memory
    print(f"Memory Samples:        {mem.samples}")
    print(f"Avg Heap Used:         {mem.avg_heap_used_mb} MB")
    print(f"Max Heap Used:         {mem.max_heap_used_mb} MB")
    print(f"Avg RSS:               {mem.avg_rss_mb} MB")
    print(f"Max RSS:               {mem.max_rss_mb} MB")
    print(f"GC Triggers:           {mem.gc_trigger_count}")

    # Interestingness Metrics
    print("\n" + "-" * 40)
    print("EXTENSION COMPLEXITY (INTERESTINGNESS)")
    print("-" * 40)
    i = report.interestingness
    print(f"Average Score:         {i.avg_score}")
    print(f"Min Score:             {i.min_score}")
    print(f"Max Score:             {i.max_score}")
    print(f"Median Score:          {i.median_score}")
    print("\nScore Distribution:")
    for bucket in i.score_distribution:
        bar = "█" * min(50, round(bucket["count"] / 10))
        print(f"  {bucket['range']:<8} {bucket['count']:>5} {bar}")

    if detailed:
        print("\nAverage Score Breakdown:")
        breakdown = asdict(i.avg_breakdown)
        entries = sorted(breakdown.items(), key=lambda x: x[1], reverse=True)
        for key, value in entries:
            if value > 0:
                print(f"  {key:<30} {value}")

    # Report Metrics
    print("\n" + "-" * 40)
    print("MANUAL TESTING REPORTS")
    print("-" * 40)
    r = report.reports
    print(f"Total Reports:         {r.total_reports}")
    print(f"Tested:                {r.tested_count}")
    print(f"Working:               {r.working_count}")
    print(f"Has Errors:            {r.has_errors_count}")
    print(f"Seems Slower:          {r.slower_count}")
    print(f"Avg Verification Time: {r.avg_verification_duration_secs}s")

    print("\n" + "=" * 80)


def dataclass_to_dict(obj):
    """Convert dataclass to dict, handling nested dataclasses."""
    if hasattr(obj, "__dataclass_fields__"):
        return {k: dataclass_to_dict(v) for k, v in asdict(obj).items()}
    elif isinstance(obj, list):
        return [dataclass_to_dict(i) for i in obj]
    elif isinstance(obj, dict):
        return {k: dataclass_to_dict(v) for k, v in obj.items()}
    return obj


def main():
    parser = argparse.ArgumentParser(
        description="Download and analyze ExtPorter performance metrics"
    )
    parser.add_argument("--json", action="store_true", help="Output as JSON")
    parser.add_argument("--output", type=str, help="Save report to file")
    parser.add_argument("--detailed", action="store_true", help="Include detailed breakdown")

    args = parser.parse_args()

    client = None
    try:
        client, db = connect_to_database()

        print("Collecting performance metrics...\n")

        # Collect all metrics
        report = PerformanceReport(
            generated_at=datetime.now().isoformat(),
            migration=get_migration_metrics(db),
            llm_fixes=get_llm_metrics(db),
            validation=get_validation_metrics(db),
            memory=get_memory_metrics(db),
            interestingness=get_interestingness_metrics(db),
            timing=get_log_timing_metrics(db, args.detailed),
            reports=get_report_metrics(db)
        )

        # Print report to console
        if not args.json:
            print_report(report, args.detailed)

        # Output as JSON if requested
        report_dict = dataclass_to_dict(report)
        if args.json:
            print(json.dumps(report_dict, indent=2))

        # Save to file if requested
        if args.output:
            output_path = Path(args.output).resolve()
            with open(output_path, "w") as f:
                json.dump(report_dict, f, indent=2)
            print(f"\nReport saved to: {output_path}")

    except Exception as e:
        print(f"Error collecting metrics: {e}", file=sys.stderr)
        sys.exit(1)

    finally:
        if client:
            client.close()


if __name__ == "__main__":
    main()
