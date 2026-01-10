#!/usr/bin/env python3
"""
Optimized Heap Snapshot Analyzer

Designed to efficiently analyze hundreds of gigabyte-sized V8 heap snapshots.
Key optimizations:
- Streaming JSON parsing with ijson (no full file loading)
- Parallel processing of multiple snapshots
- Vectorized operations with NumPy
- Memory-mapped file access for very large files
- Binary caching for repeated analysis
- Progress tracking and performance metrics
"""

import json
import os
import sys
import re
import time
import mmap
import pickle
import hashlib
import threading
from collections import defaultdict, Counter
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple, Optional, Iterator, Union, Any
from contextlib import contextmanager
import multiprocessing as mp

try:
    import ijson

    HAS_IJSON = True
except ImportError:
    HAS_IJSON = False

try:
    import numpy as np

    HAS_NUMPY = True
except ImportError:
    HAS_NUMPY = False

try:
    import lz4.frame

    HAS_LZ4 = True
except ImportError:
    HAS_LZ4 = False

try:
    from tqdm import tqdm

    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False


@dataclass
class AnalysisConfig:
    """Configuration for heap analysis optimization"""

    # Performance settings
    max_workers: int = field(
        default_factory=lambda: min(32, max(1, mp.cpu_count()))
    )  # Cap at 32 workers
    chunk_size_mb: int = 64  # Size of chunks for streaming processing
    memory_limit_gb: float = 8.0  # Memory limit for analysis
    use_streaming: bool = True  # Use streaming parser for large files
    streaming_threshold_mb: int = 100  # Use streaming for files larger than this

    # Caching settings
    enable_binary_cache: bool = True
    cache_dir: str = ".heap_cache"
    cache_compression: bool = True

    # Analysis settings
    sample_rate: float = 1.0  # Fraction of nodes to sample (1.0 = all)
    min_growth_threshold_mb: int = 1  # Minimum growth to report
    top_n_objects: int = 10

    # Output settings
    show_progress: bool = True
    detailed_output: bool = True
    output_format: str = "text"  # text, json, csv


@dataclass
class SnapshotMetrics:
    """Performance metrics for snapshot processing"""

    filename: str
    file_size_mb: float
    parse_time_seconds: float
    memory_used_mb: float
    used_streaming: bool = False
    used_cache: bool = False


@dataclass
class SnapshotData:
    """Processed snapshot data"""

    filepath: str
    filename: str
    node_count: int
    edge_count: int
    total_size: int
    type_stats: Dict[str, Dict[str, int]]
    name_stats: Dict[str, Dict[str, int]]
    processing_time: float = 0.0
    file_size_mb: float = 0.0


class ProgressTracker:
    """Thread-safe progress tracker"""

    def __init__(self, total: int, description: str = "Processing"):
        self.total = total
        self.description = description
        self.completed = 0
        self.lock = threading.Lock()
        self.start_time = time.time()

        if HAS_TQDM:
            self.pbar = tqdm(total=total, desc=description, unit="files")
        else:
            self.pbar = None

    def update(self, n: int = 1):
        with self.lock:
            self.completed += n
            if self.pbar:
                self.pbar.update(n)
            else:
                elapsed = time.time() - self.start_time
                rate = self.completed / elapsed if elapsed > 0 else 0
                print(
                    f"\r{self.description}: {self.completed}/{self.total} "
                    f"({self.completed / self.total * 100:.1f}%) "
                    f"[{rate:.1f} files/s]",
                    end="",
                    flush=True,
                )

    def close(self):
        if self.pbar:
            self.pbar.close()
        else:
            print()  # New line after progress


class FastHeapAnalyzer:
    """Optimized heap snapshot analyzer for large-scale analysis"""

    def __init__(self, directory: str = ".", config: Optional[AnalysisConfig] = None):
        self.directory = Path(directory)
        self.config = config or AnalysisConfig()
        self.cache_dir = Path(self.config.cache_dir)

        # Create cache directory if enabled
        if self.config.enable_binary_cache:
            self.cache_dir.mkdir(exist_ok=True)

        # Validate dependencies
        self._validate_dependencies()

        # Performance metrics
        self.metrics: List[SnapshotMetrics] = []

    def _validate_dependencies(self):
        """Check for optional dependencies and adjust config"""
        if not HAS_IJSON and self.config.use_streaming:
            print("⚠️  ijson not found. Install with: pip install ijson")
            print("   Falling back to standard JSON parser (slower for large files)")
            self.config.use_streaming = False

        if not HAS_NUMPY:
            print("⚠️  numpy not found. Install with: pip install numpy")
            print("   Some optimizations will be disabled")

        if not HAS_LZ4 and self.config.cache_compression:
            print("⚠️  lz4 not found. Install with: pip install lz4")
            print("   Using uncompressed cache (larger disk usage)")
            self.config.cache_compression = False

        if not HAS_TQDM and self.config.show_progress:
            print("⚠️  tqdm not found. Install with: pip install tqdm")
            print("   Using basic progress display")

    def find_snapshots(self) -> List[Tuple[str, str, float]]:
        """Find all heap snapshot files and sort them by sequence"""
        files = []

        # Pattern to match heap snapshot files
        patterns = [
            r"heap-start-(\d+)\.heapsnapshot",
            r"heap-after-(\d+)-extensions-(\d+)\.heapsnapshot",
        ]

        for file_path in self.directory.glob("*.heapsnapshot"):
            filename = file_path.name
            file_size_mb = file_path.stat().st_size / (1024 * 1024)

            # Try to extract sequence number
            if "heap-start" in filename:
                match = re.search(patterns[0], filename)
                if match:
                    files.append(
                        (
                            str(file_path),
                            filename,
                            -1,
                            int(match.group(1)),
                            file_size_mb,
                        )
                    )
            elif "heap-after" in filename:
                match = re.search(patterns[1], filename)
                if match:
                    seq = int(match.group(1))
                    timestamp = int(match.group(2))
                    files.append(
                        (str(file_path), filename, seq, timestamp, file_size_mb)
                    )

        # Sort by sequence number, then timestamp
        files.sort(key=lambda x: (x[2], x[3]))

        return [(f[0], f[1], f[4]) for f in files]

    def _get_cache_path(self, filepath: str) -> Path:
        """Get cache file path for a snapshot"""
        # Create hash of file path and modification time for cache key
        stat = os.stat(filepath)
        cache_key = hashlib.md5(
            f"{filepath}_{stat.st_mtime}_{stat.st_size}".encode()
        ).hexdigest()

        extension = ".lz4" if self.config.cache_compression else ".pkl"
        return self.cache_dir / f"{cache_key}{extension}"

    def _save_to_cache(self, data: SnapshotData, cache_path: Path):
        """Save processed snapshot data to cache"""
        try:
            if self.config.cache_compression and HAS_LZ4:
                with lz4.frame.open(cache_path, "wb") as f:
                    pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
            else:
                with open(cache_path, "wb") as f:
                    pickle.dump(data, f, protocol=pickle.HIGHEST_PROTOCOL)
        except Exception as e:
            print(f"Warning: Failed to save cache for {data.filename}: {e}")

    def _load_from_cache(self, cache_path: Path) -> Optional[SnapshotData]:
        """Load processed snapshot data from cache"""
        try:
            if cache_path.exists():
                if self.config.cache_compression and HAS_LZ4:
                    with lz4.frame.open(cache_path, "rb") as f:
                        return pickle.load(f)
                else:
                    with open(cache_path, "rb") as f:
                        return pickle.load(f)
        except Exception as e:
            print(f"Warning: Failed to load cache from {cache_path}: {e}")
        return None

    @contextmanager
    def _memory_mapped_file(self, filepath: str):
        """Context manager for memory-mapped file access"""
        with open(filepath, "rb") as f:
            with mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm:
                yield mm

    def _parse_streaming(self, filepath: str) -> Optional[SnapshotData]:
        """Parse snapshot using streaming JSON parser"""
        start_time = time.time()

        try:
            # Initialize stats
            type_stats = defaultdict(lambda: {"count": 0, "size": 0})
            name_stats = defaultdict(lambda: {"count": 0, "size": 0})
            total_size = 0
            node_count = 0
            edge_count = 0

            # Metadata storage
            meta = {}
            strings = []
            node_types = []
            node_fields = []

            with open(filepath, "rb") as f:
                # Parse metadata first
                parser = ijson.parse(f)

                # Track parsing state
                in_nodes = False
                in_strings = False
                in_meta = False
                field_count = 0
                type_idx = 0
                name_idx = 1
                self_size_idx = 3

                current_node_data = []
                nodes_processed = 0

                for prefix, event, value in parser:
                    # Parse metadata
                    if prefix == "snapshot.meta.node_fields.item":
                        node_fields.append(value)
                    elif prefix == "snapshot.meta.node_types.item.item":
                        node_types.append(value)
                    elif prefix == "snapshot.node_count":
                        node_count = value
                    elif prefix == "snapshot.edge_count":
                        edge_count = value
                    elif prefix == "strings.item":
                        strings.append(value)
                    elif prefix.startswith("nodes.item"):
                        # Process nodes in chunks
                        if field_count == 0 and node_fields:
                            field_count = len(node_fields)
                            # Find correct field indices
                            if "type" in node_fields:
                                type_idx = node_fields.index("type")
                            if "name" in node_fields:
                                name_idx = node_fields.index("name")
                            if "self_size" in node_fields:
                                self_size_idx = node_fields.index("self_size")

                        current_node_data.append(value)

                        # Process complete node
                        if len(current_node_data) == field_count:
                            # Apply sampling if configured
                            if (
                                self.config.sample_rate >= 1.0
                                or nodes_processed % int(1 / self.config.sample_rate)
                                == 0
                            ):
                                node_type_idx = current_node_data[type_idx]
                                node_name_idx = current_node_data[name_idx]
                                node_size = current_node_data[self_size_idx]

                                # Get type and name strings safely
                                node_type = (
                                    node_types[0][node_type_idx]
                                    if node_type_idx < len(node_types[0])
                                    else "unknown"
                                )
                                node_name = (
                                    strings[node_name_idx]
                                    if node_name_idx < len(strings)
                                    else "unknown"
                                )

                                # Update statistics
                                type_stats[node_type]["count"] += 1
                                type_stats[node_type]["size"] += node_size

                                name_stats[node_name]["count"] += 1
                                name_stats[node_name]["size"] += node_size

                                total_size += node_size

                            nodes_processed += 1
                            current_node_data = []

                # Adjust for sampling
                if self.config.sample_rate < 1.0:
                    scale_factor = 1.0 / self.config.sample_rate
                    total_size = int(total_size * scale_factor)
                    for stats in type_stats.values():
                        stats["count"] = int(stats["count"] * scale_factor)
                        stats["size"] = int(stats["size"] * scale_factor)
                    for stats in name_stats.values():
                        stats["count"] = int(stats["count"] * scale_factor)
                        stats["size"] = int(stats["size"] * scale_factor)

            parse_time = time.time() - start_time
            file_size_mb = os.path.getsize(filepath) / (1024 * 1024)

            return SnapshotData(
                filepath=filepath,
                filename=os.path.basename(filepath),
                node_count=node_count,
                edge_count=edge_count,
                total_size=total_size,
                type_stats=dict(type_stats),
                name_stats=dict(name_stats),
                processing_time=parse_time,
                file_size_mb=file_size_mb,
            )

        except Exception as e:
            print(f"⚠️  Streaming parse error for {os.path.basename(filepath)}: {e}")
            return None

    def _parse_vectorized(self, filepath: str) -> Optional[SnapshotData]:
        """Parse snapshot using vectorized operations with NumPy"""
        start_time = time.time()

        try:
            with open(filepath, "r") as f:
                data = json.load(f)
        except Exception as e:
            print(f"⚠️  JSON parse error for {os.path.basename(filepath)}: {e}")
            return None

        snapshot = data.get("snapshot", {})
        meta = snapshot.get("meta", {})

        # Extract basic info
        node_count = snapshot.get("node_count", 0)
        edge_count = snapshot.get("edge_count", 0)

        # Parse nodes to get memory info
        nodes_raw = data.get("nodes", [])
        strings = data.get("strings", [])

        node_fields = meta.get("node_fields", [])
        node_types = meta.get("node_types", [[]])[0]

        if not nodes_raw or not HAS_NUMPY:
            # Fall back to original parsing
            return self._parse_original(filepath, data)

        # Field indices
        type_idx = node_fields.index("type") if "type" in node_fields else 0
        name_idx = node_fields.index("name") if "name" in node_fields else 1
        self_size_idx = (
            node_fields.index("self_size") if "self_size" in node_fields else 3
        )

        field_count = len(node_fields)

        # Convert to numpy array for vectorized operations
        try:
            nodes_array = np.array(nodes_raw, dtype=np.int64)
            nodes_reshaped = nodes_array.reshape(-1, field_count)

            # Apply sampling if configured
            if self.config.sample_rate < 1.0:
                sample_size = int(len(nodes_reshaped) * self.config.sample_rate)
                indices = np.random.choice(
                    len(nodes_reshaped), sample_size, replace=False
                )
                nodes_reshaped = nodes_reshaped[indices]

            # Vectorized size calculation
            sizes = nodes_reshaped[:, self_size_idx]
            total_size = int(np.sum(sizes))

            # Extract type and name indices
            type_indices = nodes_reshaped[:, type_idx]
            name_indices = nodes_reshaped[:, name_idx]

            # Count occurrences and sum sizes by type
            type_stats = defaultdict(lambda: {"count": 0, "size": 0})
            name_stats = defaultdict(lambda: {"count": 0, "size": 0})

            # Use numpy's unique and bincount for efficient counting
            unique_types, type_counts = np.unique(type_indices, return_counts=True)

            for type_idx_val, count in zip(unique_types, type_counts):
                if type_idx_val < len(node_types):
                    type_name = node_types[type_idx_val]
                    mask = type_indices == type_idx_val
                    type_size = int(np.sum(sizes[mask]))

                    type_stats[type_name]["count"] = int(count)
                    type_stats[type_name]["size"] = type_size

            # Process names (more selective due to memory usage)
            if len(strings) < 100000:  # Only process names for reasonable string tables
                unique_names, name_counts = np.unique(name_indices, return_counts=True)

                for name_idx_val, count in zip(unique_names, name_counts):
                    if name_idx_val < len(strings):
                        name = strings[name_idx_val]
                        mask = name_indices == name_idx_val
                        name_size = int(np.sum(sizes[mask]))

                        name_stats[name]["count"] = int(count)
                        name_stats[name]["size"] = name_size

            # Adjust for sampling
            if self.config.sample_rate < 1.0:
                scale_factor = 1.0 / self.config.sample_rate
                total_size = int(total_size * scale_factor)
                for stats in type_stats.values():
                    stats["count"] = int(stats["count"] * scale_factor)
                    stats["size"] = int(stats["size"] * scale_factor)
                for stats in name_stats.values():
                    stats["count"] = int(stats["count"] * scale_factor)
                    stats["size"] = int(stats["size"] * scale_factor)

        except Exception as e:
            print(
                f"⚠️  Vectorized processing failed for {os.path.basename(filepath)}: {e}"
            )
            # Fall back to original parsing
            return self._parse_original(filepath, data)

        parse_time = time.time() - start_time
        file_size_mb = os.path.getsize(filepath) / (1024 * 1024)

        return SnapshotData(
            filepath=filepath,
            filename=os.path.basename(filepath),
            node_count=node_count,
            edge_count=edge_count,
            total_size=total_size,
            type_stats=dict(type_stats),
            name_stats=dict(name_stats),
            processing_time=parse_time,
            file_size_mb=file_size_mb,
        )

    def _parse_original(
        self, filepath: str, data: Optional[Dict] = None
    ) -> Optional[SnapshotData]:
        """Original parsing method as fallback"""
        start_time = time.time()

        if data is None:
            try:
                with open(filepath, "r") as f:
                    data = json.load(f)
            except Exception as e:
                print(f"⚠️  JSON parse error for {os.path.basename(filepath)}: {e}")
                return None

        snapshot = data.get("snapshot", {})
        meta = snapshot.get("meta", {})

        # Extract basic info
        node_count = snapshot.get("node_count", 0)
        edge_count = snapshot.get("edge_count", 0)

        # Parse nodes to get memory info
        nodes_raw = data.get("nodes", [])
        strings = data.get("strings", [])

        node_fields = meta.get("node_fields", [])
        node_types = meta.get("node_types", [[]])[0]

        # Field indices
        type_idx = node_fields.index("type") if "type" in node_fields else 0
        name_idx = node_fields.index("name") if "name" in node_fields else 1
        self_size_idx = (
            node_fields.index("self_size") if "self_size" in node_fields else 3
        )

        field_count = len(node_fields)

        # Analyze nodes
        type_stats = defaultdict(lambda: {"count": 0, "size": 0})
        name_stats = defaultdict(lambda: {"count": 0, "size": 0})
        total_size = 0
        nodes_processed = 0

        for i in range(0, len(nodes_raw), field_count):
            if i + field_count > len(nodes_raw):
                break

            # Apply sampling if configured
            if (
                self.config.sample_rate >= 1.0
                or nodes_processed % int(1 / self.config.sample_rate) == 0
            ):
                node_type_idx = nodes_raw[i + type_idx]
                node_name_idx = nodes_raw[i + name_idx]
                node_size = nodes_raw[i + self_size_idx]

                # Get type and name strings
                node_type = (
                    node_types[node_type_idx]
                    if node_type_idx < len(node_types)
                    else "unknown"
                )
                node_name = (
                    strings[node_name_idx]
                    if node_name_idx < len(strings)
                    else "unknown"
                )

                type_stats[node_type]["count"] += 1
                type_stats[node_type]["size"] += node_size

                name_stats[node_name]["count"] += 1
                name_stats[node_name]["size"] += node_size

                total_size += node_size

            nodes_processed += 1

        # Adjust for sampling
        if self.config.sample_rate < 1.0:
            scale_factor = 1.0 / self.config.sample_rate
            total_size = int(total_size * scale_factor)
            for stats in type_stats.values():
                stats["count"] = int(stats["count"] * scale_factor)
                stats["size"] = int(stats["size"] * scale_factor)
            for stats in name_stats.values():
                stats["count"] = int(stats["count"] * scale_factor)
                stats["size"] = int(stats["size"] * scale_factor)

        parse_time = time.time() - start_time
        file_size_mb = os.path.getsize(filepath) / (1024 * 1024)

        return SnapshotData(
            filepath=filepath,
            filename=os.path.basename(filepath),
            node_count=node_count,
            edge_count=edge_count,
            total_size=total_size,
            type_stats=dict(type_stats),
            name_stats=dict(name_stats),
            processing_time=parse_time,
            file_size_mb=file_size_mb,
        )

    def parse_snapshot(
        self, filepath: str, file_size_mb: float
    ) -> Optional[SnapshotData]:
        """Parse a single heap snapshot file with optimizations"""
        start_time = time.time()
        used_cache = False
        used_streaming = False

        # Check cache first
        if self.config.enable_binary_cache:
            cache_path = self._get_cache_path(filepath)
            cached_data = self._load_from_cache(cache_path)
            if cached_data:
                used_cache = True
                result = cached_data
                result.processing_time = time.time() - start_time

                # Record metrics
                self.metrics.append(
                    SnapshotMetrics(
                        filename=os.path.basename(filepath),
                        file_size_mb=file_size_mb,
                        parse_time_seconds=result.processing_time,
                        memory_used_mb=0.0,  # Cache doesn't use much memory
                        used_streaming=False,
                        used_cache=True,
                    )
                )

                return result

        # Choose parsing method based on file size and available libraries
        result = None

        if (
            self.config.use_streaming
            and HAS_IJSON
            and file_size_mb > self.config.streaming_threshold_mb
        ):
            # Use streaming parser for large files
            result = self._parse_streaming(filepath)
            used_streaming = True
        elif HAS_NUMPY:
            # Use vectorized parsing for medium files
            result = self._parse_vectorized(filepath)
        else:
            # Fall back to original parser
            result = self._parse_original(filepath)

        if result is None:
            return None

        # Cache result if enabled
        if self.config.enable_binary_cache and not used_cache:
            cache_path = self._get_cache_path(filepath)
            self._save_to_cache(result, cache_path)

        # Record metrics
        parse_time = time.time() - start_time
        self.metrics.append(
            SnapshotMetrics(
                filename=result.filename,
                file_size_mb=file_size_mb,
                parse_time_seconds=parse_time,
                memory_used_mb=0.0,  # TODO: Add memory monitoring
                used_streaming=used_streaming,
                used_cache=used_cache,
            )
        )

        return result

    def analyze_growth(self):
        """Analyze memory growth across all snapshots with parallel processing"""
        start_time = time.time()

        snapshot_files = self.find_snapshots()

        if not snapshot_files:
            print("❌ No heap snapshot files found in the directory!")
            return

        total_size_gb = sum(size_mb for _, _, size_mb in snapshot_files) / 1024
        print(
            f"✓ Found {len(snapshot_files)} heap snapshot(s) ({total_size_gb:.2f} GB total)"
        )

        if self.config.show_progress:
            print(f"📊 Configuration:")
            print(f"   Workers: {self.config.max_workers}")
            print(f"   Streaming: {self.config.use_streaming and HAS_IJSON}")
            print(f"   Vectorized: {HAS_NUMPY}")
            print(f"   Cache: {self.config.enable_binary_cache}")
            print(f"   Sample rate: {self.config.sample_rate:.0%}")

        print("\n" + "=" * 80)

        # Process snapshots in parallel
        results = []
        progress = (
            ProgressTracker(len(snapshot_files), "Parsing snapshots")
            if self.config.show_progress
            else None
        )

        if self.config.max_workers > 1:
            # Parallel processing
            with ProcessPoolExecutor(max_workers=self.config.max_workers) as executor:
                # Submit all tasks
                future_to_file = {
                    executor.submit(
                        self._parse_snapshot_worker, filepath, file_size_mb
                    ): (filepath, filename, file_size_mb)
                    for filepath, filename, file_size_mb in snapshot_files
                }

                # Collect results as they complete
                for future in as_completed(future_to_file):
                    filepath, filename, file_size_mb = future_to_file[future]
                    try:
                        result = future.result()
                        if result:
                            results.append(result)
                    except Exception as e:
                        print(f"\n⚠️  Error processing {filename}: {e}")

                    if progress:
                        progress.update()
        else:
            # Sequential processing
            for filepath, filename, file_size_mb in snapshot_files:
                result = self.parse_snapshot(filepath, file_size_mb)
                if result:
                    results.append(result)

                if progress:
                    progress.update()

        if progress:
            progress.close()

        # Sort results by filename for consistent ordering
        results.sort(key=lambda x: x.filename)

        total_time = time.time() - start_time

        # Display performance metrics
        if self.config.show_progress and self.metrics:
            print(f"\n📈 Performance Metrics:")
            print(f"   Total processing time: {total_time:.1f}s")
            total_mb = sum(m.file_size_mb for m in self.metrics)
            throughput = total_mb / total_time if total_time > 0 else 0
            print(f"   Throughput: {throughput:.1f} MB/s")

            streaming_count = sum(1 for m in self.metrics if m.used_streaming)
            cache_count = sum(1 for m in self.metrics if m.used_cache)
            print(f"   Used streaming: {streaming_count}/{len(self.metrics)}")
            print(f"   Used cache: {cache_count}/{len(self.metrics)}")

        # Analyze results
        if not results:
            print("\n❌ No valid heap snapshots could be parsed!")
            return
        elif len(results) == 1:
            print(
                "\n⚠️  Only one valid snapshot found. Need multiple snapshots to analyze growth."
            )
            self._display_single_snapshot(results[0])
            return
        else:
            self._analyze_growth_trends(results)

    def _parse_snapshot_worker(
        self, filepath: str, file_size_mb: float
    ) -> Optional[SnapshotData]:
        """Worker function for parallel snapshot parsing"""
        # Create a new analyzer instance for this worker to avoid shared state
        worker_analyzer = FastHeapAnalyzer(self.directory, self.config)
        return worker_analyzer.parse_snapshot(filepath, file_size_mb)

    def _display_single_snapshot(self, snapshot: SnapshotData):
        """Display summary of a single snapshot"""
        print(f"📊 Snapshot: {snapshot.filename}")
        print(f"  Nodes: {snapshot.node_count:,}")
        print(f"  Edges: {snapshot.edge_count:,}")
        print(f"  Total Size: {self.format_bytes(snapshot.total_size)}")
        print(f"  Processing time: {snapshot.processing_time:.2f}s")

        print(f"\n🔍 Top {self.config.top_n_objects} Object Types by Size:")
        type_stats = sorted(
            snapshot.type_stats.items(), key=lambda x: x[1]["size"], reverse=True
        )[: self.config.top_n_objects]
        for type_name, stats in type_stats:
            print(
                f"  {type_name:25s}: {stats['count']:8,} objects, {self.format_bytes(stats['size'])}"
            )

    def _analyze_growth_trends(self, results: List[SnapshotData]):
        """Analyze memory growth trends across multiple snapshots"""
        print(f"\n📈 MEMORY GROWTH ANALYSIS ({len(results)} snapshots)")
        print("=" * 80)

        baseline = results[0]
        print(f"\nBaseline: {baseline.filename}")
        print(f"  Size: {self.format_bytes(baseline.total_size)}")
        print(f"  Nodes: {baseline.node_count:,}")

        # Growth analysis
        max_growth = 0
        max_growth_snapshot = None
        growth_rate_mb_per_snapshot = []

        for i, snapshot in enumerate(results[1:], 1):
            size_diff = snapshot.total_size - baseline.total_size
            size_percent = (
                (size_diff / baseline.total_size * 100)
                if baseline.total_size > 0
                else 0
            )
            node_diff = snapshot.node_count - baseline.node_count

            print(f"\n{snapshot.filename}:")
            print(
                f"  Size: {self.format_bytes(snapshot.total_size)} "
                f"({'+' if size_diff >= 0 else ''}{self.format_bytes(size_diff)}, "
                f"{'+' if size_percent >= 0 else ''}{size_percent:.1f}%)"
            )
            print(
                f"  Nodes: {snapshot.node_count:,} "
                f"({'+' if node_diff >= 0 else ''}{node_diff:,})"
            )

            if size_diff > max_growth:
                max_growth = size_diff
                max_growth_snapshot = snapshot

            # Calculate growth rate
            if i > 0:
                prev_snapshot = results[i - 1] if i > 1 else baseline
                snapshot_growth = snapshot.total_size - prev_snapshot.total_size
                growth_rate_mb_per_snapshot.append(snapshot_growth / (1024 * 1024))

        # Find growing object types
        print(f"\n🔍 OBJECT TYPES WITH LARGEST GROWTH:")
        print("-" * 80)

        baseline_types = baseline.type_stats
        type_growth = {}

        for snapshot in results[1:]:
            for type_name, stats in snapshot.type_stats.items():
                baseline_size = baseline_types.get(type_name, {}).get("size", 0)
                growth = stats["size"] - baseline_size

                # Only track significant growth
                if growth > self.config.min_growth_threshold_mb * 1024 * 1024:
                    if (
                        type_name not in type_growth
                        or growth > type_growth[type_name]["max_growth"]
                    ):
                        type_growth[type_name] = {
                            "max_growth": growth,
                            "baseline_count": baseline_types.get(type_name, {}).get(
                                "count", 0
                            ),
                            "current_count": stats["count"],
                            "baseline_size": baseline_size,
                            "current_size": stats["size"],
                        }

        # Sort by growth and display
        top_growing = sorted(
            type_growth.items(), key=lambda x: x[1]["max_growth"], reverse=True
        )[: self.config.top_n_objects]

        for type_name, growth_data in top_growing:
            if growth_data["max_growth"] > 0:
                count_diff = (
                    growth_data["current_count"] - growth_data["baseline_count"]
                )
                print(f"\n{type_name}:")
                print(f"  Growth: +{self.format_bytes(growth_data['max_growth'])}")
                print(
                    f"  Count: {growth_data['baseline_count']:,} → {growth_data['current_count']:,} "
                    f"(+{count_diff:,})"
                )
                print(
                    f"  Size: {self.format_bytes(growth_data['baseline_size'])} → "
                    f"{self.format_bytes(growth_data['current_size'])}"
                )

        # Advanced analytics
        print(f"\n📊 TREND ANALYSIS:")
        print("-" * 80)

        if len(growth_rate_mb_per_snapshot) > 2:
            avg_growth_rate = sum(growth_rate_mb_per_snapshot) / len(
                growth_rate_mb_per_snapshot
            )
            print(f"Average growth rate: {avg_growth_rate:.1f} MB per snapshot")

            # Detect acceleration/deceleration
            if len(growth_rate_mb_per_snapshot) >= 3:
                first_half = growth_rate_mb_per_snapshot[
                    : len(growth_rate_mb_per_snapshot) // 2
                ]
                second_half = growth_rate_mb_per_snapshot[
                    len(growth_rate_mb_per_snapshot) // 2 :
                ]

                avg_first = sum(first_half) / len(first_half)
                avg_second = sum(second_half) / len(second_half)

                if avg_second > avg_first * 1.5:
                    print("⚠️  Growth is accelerating!")
                elif avg_second < avg_first * 0.5:
                    print("✓ Growth is decelerating")

        # Summary
        print(f"\n" + "=" * 80)
        print("💡 SUMMARY")
        print("=" * 80)
        final = results[-1]
        total_growth = final.total_size - baseline.total_size
        total_percent = (
            (total_growth / baseline.total_size * 100) if baseline.total_size > 0 else 0
        )

        print(
            f"Total Memory Growth: {self.format_bytes(total_growth)} ({total_percent:.1f}%)"
        )
        print(
            f"From: {self.format_bytes(baseline.total_size)} → {self.format_bytes(final.total_size)}"
        )
        print(f"Snapshots Analyzed: {len(results)}")

        if max_growth_snapshot:
            print(
                f"Largest single growth: {self.format_bytes(max_growth)} in {max_growth_snapshot.filename}"
            )

        if total_growth > 0:
            print(
                f"\n⚠️  Memory grew by {self.format_bytes(total_growth)} across snapshots."
            )
            print("   Check the growing object types above for potential memory leaks.")
        else:
            print(f"\n✓ Memory appears stable or decreased.")

        # Performance summary
        total_processing_time = sum(r.processing_time for r in results)
        total_file_size = sum(r.file_size_mb for r in results)
        print(
            f"\nProcessing completed in {total_processing_time:.1f}s "
            f"({total_file_size:.1f} MB at {total_file_size / total_processing_time:.1f} MB/s)"
        )

    def format_bytes(self, bytes_val: int) -> str:
        """Format bytes to human readable format"""
        for unit in ["B", "KB", "MB", "GB"]:
            if bytes_val < 1024.0:
                return f"{bytes_val:.2f} {unit}"
            bytes_val /= 1024.0
        return f"{bytes_val:.2f} TB"

    def clear_cache(self):
        """Clear the binary cache"""
        if self.cache_dir.exists():
            import shutil

            shutil.rmtree(self.cache_dir)
            print(f"✓ Cache cleared: {self.cache_dir}")
        else:
            print("ℹ️  No cache to clear")


def main():
    """Main entry point"""
    import argparse

    parser = argparse.ArgumentParser(
        description="Optimized Heap Snapshot Analyzer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                           # Analyze current directory
  %(prog)s /path/to/snapshots        # Analyze specific directory
  %(prog)s --workers 8               # Use 8 parallel workers
  %(prog)s --sample-rate 0.1         # Analyze 10%% sample for speed
  %(prog)s --no-cache               # Disable caching
  %(prog)s --clear-cache            # Clear cache and exit
        """,
    )

    parser.add_argument(
        "directory",
        nargs="?",
        default=".",
        help="Directory containing heap snapshots (default: current directory)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help=f"Number of parallel workers (default: {mp.cpu_count()})",
    )
    parser.add_argument(
        "--sample-rate",
        type=float,
        default=1.0,
        help="Fraction of nodes to analyze (default: 1.0 = all)",
    )
    parser.add_argument(
        "--no-cache", action="store_true", help="Disable binary caching"
    )
    parser.add_argument(
        "--no-streaming", action="store_true", help="Disable streaming parser"
    )
    parser.add_argument(
        "--streaming-threshold",
        type=int,
        default=100,
        help="File size threshold for streaming (MB)",
    )
    parser.add_argument(
        "--clear-cache", action="store_true", help="Clear cache and exit"
    )
    parser.add_argument("--quiet", action="store_true", help="Minimal output")
    parser.add_argument(
        "--memory-limit",
        type=float,
        default=8.0,
        help="Memory limit in GB (default: 8.0)",
    )

    args = parser.parse_args()

    if not os.path.isdir(args.directory):
        print(f"❌ Directory not found: {args.directory}")
        sys.exit(1)

    # Create configuration
    config = AnalysisConfig(
        max_workers=args.workers if args.workers else mp.cpu_count(),
        memory_limit_gb=args.memory_limit,
        use_streaming=not args.no_streaming,
        streaming_threshold_mb=args.streaming_threshold,
        enable_binary_cache=not args.no_cache,
        sample_rate=max(0.01, min(1.0, args.sample_rate)),
        show_progress=not args.quiet,
    )

    analyzer = FastHeapAnalyzer(args.directory, config)

    if args.clear_cache:
        analyzer.clear_cache()
        return

    print("🚀 Fast Heap Snapshot Analyzer")
    print(f"   Version: Optimized for large-scale analysis")
    print(f"   Directory: {args.directory}")

    try:
        analyzer.analyze_growth()
    except KeyboardInterrupt:
        print("\n\n⚠️  Analysis interrupted by user")
    except Exception as e:
        print(f"\n❌ Analysis failed: {e}")
        if not args.quiet:
            import traceback

            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
