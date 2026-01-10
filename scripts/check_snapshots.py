#!/usr/bin/env python3
"""
Quick diagnostic script to check heap snapshot file health
and estimate completion time for the current analysis.
"""

import os
import json
import time
from pathlib import Path


def check_file_health(filepath):
    """Check if a heap snapshot file is valid"""
    try:
        # Check if file can be opened as UTF-8
        with open(filepath, "r", encoding="utf-8") as f:
            # Try to read first few KB
            chunk = f.read(1024)
            if not chunk.strip().startswith("{"):
                return False, "Not JSON format"

        # Try to parse as JSON (just the beginning)
        with open(filepath, "r", encoding="utf-8") as f:
            # Read small chunk to verify JSON structure
            content = f.read(8192)
            if '"snapshot"' in content and '"nodes"' in content:
                return True, "Valid"
            else:
                return False, "Invalid JSON structure"

    except UnicodeDecodeError as e:
        return False, f"Encoding error: {str(e)[:50]}"
    except Exception as e:
        return False, f"Error: {str(e)[:50]}"


def analyze_snapshots(directory):
    """Analyze all snapshot files in directory"""
    print(f"🔍 Analyzing heap snapshots in: {directory}")
    print("=" * 60)

    snapshot_files = list(Path(directory).glob("*.heapsnapshot"))

    if not snapshot_files:
        print("❌ No .heapsnapshot files found!")
        return

    print(f"📊 Found {len(snapshot_files)} snapshot files")

    valid_files = []
    corrupted_files = []
    total_size_gb = 0
    valid_size_gb = 0

    print("\n🔍 Checking file health...")
    start_time = time.time()

    for i, filepath in enumerate(snapshot_files):
        if i % 50 == 0:  # Progress every 50 files
            elapsed = time.time() - start_time
            rate = i / elapsed if elapsed > 0 else 0
            remaining = (len(snapshot_files) - i) / rate if rate > 0 else 0
            print(
                f"   Progress: {i}/{len(snapshot_files)} ({i / len(snapshot_files) * 100:.1f}%) "
                f"ETA: {remaining:.0f}s"
            )

        file_size_gb = filepath.stat().st_size / (1024**3)
        total_size_gb += file_size_gb

        is_valid, reason = check_file_health(filepath)

        if is_valid:
            valid_files.append(filepath)
            valid_size_gb += file_size_gb
        else:
            corrupted_files.append((filepath, reason))

    # Results
    print(f"\n📈 ANALYSIS RESULTS:")
    print("=" * 60)
    print(f"Total files:     {len(snapshot_files):,}")
    print(
        f"Valid files:     {len(valid_files):,} ({len(valid_files) / len(snapshot_files) * 100:.1f}%)"
    )
    print(
        f"Corrupted files: {len(corrupted_files):,} ({len(corrupted_files) / len(snapshot_files) * 100:.1f}%)"
    )
    print(f"")
    print(f"Total size:      {total_size_gb:.1f} GB")
    print(
        f"Valid data:      {valid_size_gb:.1f} GB ({valid_size_gb / total_size_gb * 100:.1f}%)"
    )
    print(f"Corrupted data:  {total_size_gb - valid_size_gb:.1f} GB")

    # Estimate completion time
    if len(valid_files) > 0:
        print(f"\n⏱️  TIMING ESTIMATES:")
        print("-" * 30)

        # Assume current rate of ~1.5 files/second for valid files
        estimated_rate = 1.5  # files per second (based on your output)
        remaining_valid_files = len(valid_files)

        estimated_time_seconds = remaining_valid_files / estimated_rate
        estimated_hours = estimated_time_seconds / 3600
        estimated_minutes = (estimated_time_seconds % 3600) / 60

        print(f"Estimated completion time for valid files:")
        print(f"  At 1.5 files/sec: {estimated_hours:.0f}h {estimated_minutes:.0f}m")
        print(
            f"  At 3.0 files/sec: {estimated_time_seconds / 2 / 3600:.0f}h {(estimated_time_seconds / 2 % 3600) / 60:.0f}m"
        )

    # Show sample of corrupted files
    if corrupted_files:
        print(f"\n⚠️  SAMPLE CORRUPTED FILES:")
        print("-" * 40)
        for filepath, reason in corrupted_files[:10]:
            filename = filepath.name
            size_mb = filepath.stat().st_size / (1024**2)
            print(f"  {filename} ({size_mb:.1f} MB): {reason}")

        if len(corrupted_files) > 10:
            print(f"  ... and {len(corrupted_files) - 10} more")

    # Recommendations
    print(f"\n💡 RECOMMENDATIONS:")
    print("-" * 20)

    if len(corrupted_files) > len(snapshot_files) * 0.1:
        print("⚠️  High corruption rate detected!")
        print("   - Consider checking disk health")
        print("   - Verify snapshot generation process")
        print("   - The analyzer will skip corrupted files automatically")

    if len(valid_files) > 100:
        print("📊 For faster analysis of large datasets:")
        print("   - Use --sample-rate 0.1 for 10x speed (90% accuracy)")
        print("   - Use --workers 8-16 for optimal parallel processing")
        print("   - Consider analyzing subsets first")

    print(
        f"\n✅ Analysis complete! The heap analyzer will process {len(valid_files):,} valid files."
    )


if __name__ == "__main__":
    import sys

    directory = sys.argv[1] if len(sys.argv) > 1 else "./logs/"
    analyze_snapshots(directory)
