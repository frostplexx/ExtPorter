#!/usr/bin/env python3
"""
Download 100 random migrated extensions from the MongoDB database.

This script:
1. Connects to the MongoDB database (via SSH tunnel)
2. Fetches 100 random migrated extensions using a seeded random sort
3. Downloads both MV2 and MV3 versions from remote server using SCP
4. Creates a manifest file with details about the downloaded extensions

Usage:
    python download_random_extensions.py [output_dir] [--uri URI] [--seed SEED] [--count COUNT] [--compress] --ssh-host HOST

Arguments:
    output_dir: Output directory for downloaded extensions (default: ./downloaded_extensions)
    --uri: MongoDB URI (default: mongodb://admin:password@localhost:27017/migrator?authSource=admin)
    --seed: Random seed for reproducible selection (default: generated from timestamp)
    --count: Number of extensions to download (default: 100)
    --compress: Create tar.gz archives instead of copying directories (recommended for remote)
    --ssh-host: SSH host for downloading files (e.g., user@host.com)
    --ssh-port: SSH port (default: 22)
    --ssh-options: Additional SSH options (default: -o PreferredAuthentications=password)

Requirements:
    pip install pymongo
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import hashlib

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
DEFAULT_DB = "migrator"
EXTENSIONS_COLLECTION = "extensions"
REPORTS_COLLECTION = "reports"


def connect_to_db(uri: str) -> MongoClient:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        # Test the connection
        client.admin.command("ping")
        print("✓ Connected to MongoDB")
        return client
    except Exception as e:
        print(f"✗ Error connecting to MongoDB: {e}")
        sys.exit(1)


def generate_seed() -> str:
    """Generate a random seed based on current timestamp."""
    timestamp = str(datetime.now().timestamp())
    return hashlib.sha256(timestamp.encode()).hexdigest()[:16]


def get_all_tested_extensions(client: MongoClient, db_name: str) -> List[Dict]:
    """Fetch all extensions that have at least one tested report."""
    db = client[db_name]
    reports_col = db[REPORTS_COLLECTION]
    extensions_col = db[EXTENSIONS_COLLECTION]

    # Get unique extension IDs from tested reports
    tested_ids = reports_col.distinct("extension_id", {"tested": True})
    print(f"Found {len(tested_ids)} extensions with tested reports")

    if not tested_ids:
        print("✗ No tested extensions found")
        sys.exit(1)

    # Fetch extension documents that also have both MV2 and MV3 paths
    extensions = list(extensions_col.find({
        "id": {"$in": tested_ids},
        "manifest_v2_path": {"$exists": True, "$ne": None},
        "manifest_v3_path": {"$exists": True, "$ne": None},
    }))

    print(f"Found {len(extensions)} tested extensions with MV2 and MV3 paths")
    return extensions


def get_random_extensions(
    client: MongoClient, db_name: str, count: int, seed: str
) -> List[Dict]:
    """
    Fetch random migrated extensions from the database using deterministic seeded random.

    This replicates the server's getExtensionsPageWithStats logic for seeded random sorting.
    """
    db = client[db_name]
    collection = db[EXTENSIONS_COLLECTION]

    # Filter for extensions that have both MV2 and MV3 paths
    filter_query = {
        "manifest_v2_path": {"$exists": True, "$ne": None},
        "manifest_v3_path": {"$exists": True, "$ne": None},
    }

    print(f"Fetching extensions with seed: {seed}")

    # Fetch all extension IDs that match the filter
    id_docs = list(collection.find(filter_query, {"id": 1}))
    ids = [doc["id"] for doc in id_docs]

    if len(ids) == 0:
        print("✗ No extensions found with both MV2 and MV3 paths")
        sys.exit(1)

    print(f"Found {len(ids)} migrated extensions")

    # Compute hash(seed + id) for each ID for deterministic ordering
    hashes = []
    for ext_id in ids:
        hash_value = hashlib.sha256(f"{seed}::{ext_id}".encode()).hexdigest()
        hashes.append({"id": ext_id, "hash": hash_value})

    # Sort by hash
    hashes.sort(key=lambda x: x["hash"])

    # Take the first 'count' IDs
    selected_ids = [item["id"] for item in hashes[:count]]

    if len(selected_ids) == 0:
        print("✗ No extensions selected")
        sys.exit(1)

    print(f"Selected {len(selected_ids)} random extensions")

    # Fetch full documents for selected IDs
    extensions = list(collection.find({"id": {"$in": selected_ids}}))

    # Preserve the order from selected_ids
    extensions_by_id = {ext["id"]: ext for ext in extensions}
    ordered_extensions = [
        extensions_by_id[ext_id] for ext_id in selected_ids if ext_id in extensions_by_id
    ]

    return ordered_extensions


def validate_extension_paths(
    extension: Dict,
    remote_mode: bool = False,
    path_map: Optional[List[Tuple[str, str]]] = None
) -> Tuple[Optional[str], Optional[str]]:
    """
    Validate and extract MV2 and MV3 directory paths from an extension.

    Args:
        extension: Extension document from database
        remote_mode: If True, skip local file existence checks (for remote downloads)
        path_map: Optional list of (from_prefix, to_prefix) pairs for path translation

    Returns: (mv2_dir, mv3_dir) or (None, None) if paths are invalid
    """
    mv2_path = extension.get("manifest_v2_path")
    mv3_path = extension.get("manifest_v3_path")

    if not mv2_path or not mv3_path:
        return None, None

    # Strip /manifest.json if present to get directory paths
    if mv2_path.endswith("/manifest.json"):
        mv2_dir = mv2_path[: -len("/manifest.json")]
    else:
        mv2_dir = mv2_path

    if mv3_path.endswith("/manifest.json"):
        mv3_dir = mv3_path[: -len("/manifest.json")]
    else:
        mv3_dir = mv3_path

    # Apply path mappings (first match wins for each path)
    if path_map:
        for from_prefix, to_prefix in path_map:
            if mv2_dir.startswith(from_prefix):
                mv2_dir = to_prefix + mv2_dir[len(from_prefix):]
                break
        for from_prefix, to_prefix in path_map:
            if mv3_dir.startswith(from_prefix):
                mv3_dir = to_prefix + mv3_dir[len(from_prefix):]
                break

    # In remote mode, we can't check if paths exist locally
    if remote_mode:
        return mv2_dir, mv3_dir

    # Check if directories exist (local mode only)
    if not os.path.exists(mv2_dir):
        return None, None

    if not os.path.exists(mv3_dir):
        return None, None

    # Check if manifest.json files exist
    mv2_manifest = os.path.join(mv2_dir, "manifest.json")
    mv3_manifest = os.path.join(mv3_dir, "manifest.json")

    if not os.path.exists(mv2_manifest) or not os.path.exists(mv3_manifest):
        return None, None

    return mv2_dir, mv3_dir


def create_tarball(source_dir: str, output_path: str) -> None:
    """Create a gzipped tar archive of a directory."""
    with tarfile.open(output_path, "w:gz") as tar:
        tar.add(source_dir, arcname=os.path.basename(source_dir))


def _fix_permissions(path: str) -> None:
    """Recursively ensure a directory and its contents are user-readable/writable."""
    try:
        for root, dirs, files in os.walk(path):
            os.chmod(root, 0o755)
            for f in files:
                try:
                    os.chmod(os.path.join(root, f), 0o644)
                except OSError:
                    pass
    except OSError:
        pass


def download_via_scp(
    remote_path: str,
    local_path: str,
    ssh_host: str,
    ssh_port: int = 22,
    ssh_options: str = "",
    compress_remote: bool = False,
    control_path: Optional[str] = None
) -> bool:
    """
    Download a directory from remote server using SCP.

    Args:
        remote_path: Remote directory path
        local_path: Local destination path
        ssh_host: SSH host (user@host.com)
        ssh_port: SSH port
        ssh_options: Additional SSH options
        compress_remote: If True, create tar.gz on remote first, then download
        control_path: SSH ControlMaster socket path for connection reuse

    Returns: True if successful, False otherwise
    """
    try:
        # Build base SSH/SCP options
        base_ssh_opts = ["-p", str(ssh_port)]
        if control_path:
            base_ssh_opts.extend(["-o", f"ControlPath={control_path}", "-o", "ControlMaster=auto"])
        if ssh_options:
            base_ssh_opts.extend(ssh_options.split())

        SCP_TIMEOUT = 300  # seconds per transfer

        if compress_remote:
            # Create tar.gz on remote server, download it, then extract
            remote_dir = os.path.dirname(remote_path)
            remote_name = os.path.basename(remote_path)
            temp_remote_tar = f"/tmp/{remote_name}_{os.getpid()}.tar.gz"

            # Create tar on remote
            tar_cmd = ["ssh"] + base_ssh_opts + [
                ssh_host,
                f"tar -czf {temp_remote_tar} -C {remote_dir} {remote_name}"
            ]

            result = subprocess.run(tar_cmd, capture_output=True, text=True, timeout=SCP_TIMEOUT)
            if result.returncode != 0:
                print(f"    Error creating remote tar: {result.stderr}")
                return False

            # Download the tar
            local_tar = f"{local_path}.tar.gz"
            scp_cmd = ["scp"] + ["-P" if opt == "-p" else opt for opt in base_ssh_opts] + [
                f"{ssh_host}:{temp_remote_tar}",
                local_tar
            ]

            result = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=SCP_TIMEOUT)
            if result.returncode != 0:
                print(f"    Error downloading tar: {result.stderr}")
                return False

            # Extract locally to temp location
            extract_dir = os.path.dirname(local_path)
            os.makedirs(extract_dir, exist_ok=True)

            with tarfile.open(local_tar, "r:gz") as tar:
                tar.extractall(extract_dir, filter='data')

            # The tar contains the directory with original name, rename it to our expected name
            # Find what was extracted (should be one directory)
            extracted_items = [item for item in os.listdir(extract_dir) if item != os.path.basename(local_tar)]
            if len(extracted_items) == 1:
                extracted_path = os.path.join(extract_dir, extracted_items[0])
                if os.path.isdir(extracted_path) and extracted_path != local_path:
                    # Rename to expected path
                    os.rename(extracted_path, local_path)

            # Cleanup
            os.remove(local_tar)
            cleanup_cmd = ["ssh"] + base_ssh_opts + [
                ssh_host,
                f"rm -f {temp_remote_tar}"
            ]
            subprocess.run(cleanup_cmd, capture_output=True, timeout=30)

        else:
            # Direct SCP copy (recursive).
            # Remove any leftover local directory first — a previous partial download
            # may have set restrictive permissions that block SCP from writing into it.
            if os.path.exists(local_path):
                _fix_permissions(local_path)
                shutil.rmtree(local_path, ignore_errors=True)
            os.makedirs(os.path.dirname(local_path), exist_ok=True)

            scp_cmd = ["scp", "-r"] + ["-P" if opt == "-p" else opt for opt in base_ssh_opts] + [
                f"{ssh_host}:{remote_path}",
                local_path
            ]

            result = subprocess.run(scp_cmd, capture_output=True, text=True, timeout=SCP_TIMEOUT)
            if result.returncode != 0:
                print(f"    Error during SCP: {result.stderr}")
                return False

            # Ensure downloaded files are readable/removable by the current user
            _fix_permissions(local_path)

        return True

    except subprocess.TimeoutExpired:
        print(f"    Timed out after {SCP_TIMEOUT}s")
        return False
    except Exception as e:
        print(f"    Exception during download: {e}")
        return False


def get_directory_size_remote(
    remote_path: str,
    ssh_host: str,
    ssh_port: int = 22,
    ssh_options: str = "",
    control_path: Optional[str] = None
) -> int:
    """Get the size of a remote directory in bytes."""
    try:
        cmd = ["ssh", "-p", str(ssh_port)]
        if control_path:
            cmd.extend(["-o", f"ControlPath={control_path}", "-o", "ControlMaster=auto"])
        if ssh_options:
            cmd.extend(ssh_options.split())
        cmd.extend([
            ssh_host,
            f"du -sb {remote_path} | cut -f1"
        ])

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            return int(result.stdout.strip())
        return 0
    except:
        return 0


class SSHConnectionManager:
    """Manages a persistent SSH connection using ControlMaster."""

    def __init__(self, ssh_host: str, ssh_port: int = 22, ssh_options: str = ""):
        self.ssh_host = ssh_host
        self.ssh_port = ssh_port
        self.ssh_options = ssh_options
        self.control_path = None

    def __enter__(self):
        """Establish the master SSH connection."""
        # Create a temporary control socket path
        temp_dir = tempfile.gettempdir()
        self.control_path = os.path.join(temp_dir, f"ssh_control_{os.getpid()}_{os.urandom(4).hex()}")

        print("Establishing SSH master connection (enter password once)...")

        # Start SSH master connection in background
        cmd = [
            "ssh",
            "-f",  # Go to background after authentication
            "-N",  # Don't execute a command
            "-M",  # Master mode
            "-o", f"ControlPath={self.control_path}",
            "-o", "ControlMaster=yes",
            "-o", "ControlPersist=10m",  # Keep connection alive for 10 minutes after last use
            "-o", "ServerAliveInterval=60",  # Keep connection alive
            "-p", str(self.ssh_port),
        ]

        if self.ssh_options:
            cmd.extend(self.ssh_options.split())

        cmd.append(self.ssh_host)

        # Start the master connection
        # This will prompt for password once and then go to background
        result = subprocess.run(cmd, capture_output=False)

        if result.returncode != 0:
            raise Exception(f"Failed to establish SSH master connection")

        # Wait for the control socket to be created
        max_wait = 10  # seconds
        waited = 0
        while not os.path.exists(self.control_path) and waited < max_wait:
            time.sleep(0.5)
            waited += 0.5

        if not os.path.exists(self.control_path):
            raise Exception(f"SSH control socket not created after {max_wait} seconds")

        # Test if connection is alive with a simple command
        test_cmd = [
            "ssh",
            "-o", f"ControlPath={self.control_path}",
            "-o", "ControlMaster=no",
            "-p", str(self.ssh_port),
        ]
        if self.ssh_options:
            test_cmd.extend(self.ssh_options.split())
        test_cmd.extend([self.ssh_host, "echo", "test"])

        result = subprocess.run(test_cmd, capture_output=True, text=True)

        if result.returncode != 0:
            raise Exception(f"SSH master connection test failed: {result.stderr}")

        print("✓ SSH master connection established (password cached)\n")
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Close the master SSH connection."""
        if self.control_path and os.path.exists(self.control_path):
            # Send exit command to master
            exit_cmd = [
                "ssh",
                "-O", "exit",
                "-o", f"ControlPath={self.control_path}",
                "-p", str(self.ssh_port),
            ]
            if self.ssh_options:
                exit_cmd.extend(self.ssh_options.split())
            exit_cmd.append(self.ssh_host)

            subprocess.run(exit_cmd, capture_output=True)

            # Clean up control socket file if it still exists
            if os.path.exists(self.control_path):
                try:
                    os.remove(self.control_path)
                except:
                    pass

    def get_control_path(self) -> str:
        """Get the control socket path for use in SSH/SCP commands."""
        return self.control_path


def copy_extension(
    extension: Dict,
    output_dir: Path,
    compress: bool = False,
    ssh_host: Optional[str] = None,
    ssh_port: int = 22,
    ssh_options: str = "",
    control_path: Optional[str] = None,
    path_map: Optional[Tuple[str, str]] = None,
    mv3_only: bool = False
) -> Optional[Dict]:
    """
    Copy or download an extension's MV2 and MV3 versions to the output directory.

    Args:
        extension: Extension document from database
        output_dir: Output directory
        compress: Create tar.gz archives
        ssh_host: SSH host for remote downloads (None for local copy)
        ssh_port: SSH port
        ssh_options: Additional SSH options
        control_path: SSH ControlMaster socket path for connection reuse
        path_map: Optional tuple of (from_prefix, to_prefix) for path translation
        mv3_only: If True, only download MV3 (skip MV2)

    Returns: metadata dict if successful, None if failed
    """
    ext_id = extension.get("id")
    ext_name = extension.get("name", "Unknown")

    remote_mode = ssh_host is not None
    mv2_dir, mv3_dir = validate_extension_paths(extension, remote_mode=remote_mode, path_map=path_map)

    # For mv3_only mode, only check mv3_dir
    if mv3_only:
        if not mv3_dir:
            print(f"  ✗ Skipping {ext_name} ({ext_id}): missing MV3 path")
            return None
    else:
        if not mv2_dir or not mv3_dir:
            print(f"  ✗ Skipping {ext_name} ({ext_id}): invalid or missing paths")
            return None

    # Create extension directory
    ext_output_dir = output_dir / ext_id
    ext_output_dir.mkdir(parents=True, exist_ok=True)

    try:
        if remote_mode:
            # Download from remote server
            mv3_output = ext_output_dir / "mv3"

            # Download MV2 (unless mv3_only)
            mv2_size = 0
            if not mv3_only and mv2_dir:
                mv2_output = ext_output_dir / "mv2"
                if not download_via_scp(
                    mv2_dir, str(mv2_output), ssh_host, ssh_port, ssh_options,
                    compress_remote=compress, control_path=control_path
                ):
                    raise Exception("Failed to download MV2")

                if compress:
                    mv2_archive = ext_output_dir / "mv2.tar.gz"
                    create_tarball(str(mv2_output), str(mv2_archive))
                    shutil.rmtree(mv2_output)
                    mv2_size = mv2_archive.stat().st_size
                else:
                    mv2_size = sum(f.stat().st_size for f in mv2_output.rglob("*") if f.is_file())

            # Download MV3
            if not download_via_scp(
                mv3_dir, str(mv3_output), ssh_host, ssh_port, ssh_options,
                compress_remote=compress, control_path=control_path
            ):
                raise Exception("Failed to download MV3")

            # Calculate MV3 size
            if compress:
                mv3_archive = ext_output_dir / "mv3.tar.gz"
                create_tarball(str(mv3_output), str(mv3_archive))
                shutil.rmtree(mv3_output)
                mv3_size = mv3_archive.stat().st_size
            else:
                mv3_size = sum(f.stat().st_size for f in mv3_output.rglob("*") if f.is_file())

        else:
            # Local copy mode
            mv2_size = 0

            if compress:
                # Create tar.gz archives

                # MV2 (unless mv3_only)
                if not mv3_only and mv2_dir:
                    mv2_archive = ext_output_dir / "mv2.tar.gz"
                    create_tarball(mv2_dir, str(mv2_archive))
                    mv2_size = mv2_archive.stat().st_size

                # MV3
                mv3_archive = ext_output_dir / "mv3.tar.gz"
                create_tarball(mv3_dir, str(mv3_archive))
                mv3_size = mv3_archive.stat().st_size
            else:
                # Copy directories

                # MV2 (unless mv3_only)
                if not mv3_only and mv2_dir:
                    mv2_output = ext_output_dir / "mv2"
                    if mv2_output.exists():
                        shutil.rmtree(mv2_output)
                    shutil.copytree(mv2_dir, mv2_output)
                    mv2_size = sum(
                        f.stat().st_size for f in mv2_output.rglob("*") if f.is_file()
                    )

                # MV3
                mv3_output = ext_output_dir / "mv3"
                if mv3_output.exists():
                    shutil.rmtree(mv3_output)
                shutil.copytree(mv3_dir, mv3_output)
                mv3_size = sum(
                    f.stat().st_size for f in mv3_output.rglob("*") if f.is_file()
                )

        # Create metadata for this extension
        metadata = {
            "id": ext_id,
            "name": ext_name,
            "version": extension.get("version"),
            "mv2_extension_id": extension.get("mv2_extension_id"),
            "mv3_extension_id": extension.get("mv3_extension_id"),
            "interestingness_score": extension.get("interestingness_score"),
            "tags": extension.get("tags", []),
            "mv2_size_bytes": mv2_size,
            "mv3_size_bytes": mv3_size,
            "total_size_bytes": mv2_size + mv3_size,
            "cws_info": {
                "user_count": extension.get("cws_info", {})
                .get("details", {})
                .get("userCount"),
                "rating": extension.get("cws_info", {}).get("details", {}).get("rating"),
                "developer": extension.get("cws_info", {})
                .get("details", {})
                .get("developer"),
            }
            if extension.get("cws_info")
            else None,
        }

        return metadata

    except Exception as e:
        print(f"  ✗ Error processing {ext_name}: {e}")
        # Clean up partial copy (ignore permission errors from SCP-downloaded files)
        if ext_output_dir.exists():
            shutil.rmtree(ext_output_dir, ignore_errors=True)
        return None


def format_bytes(size: int) -> str:
    """Format bytes as human-readable size."""
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def create_manifest(
    output_dir: Path,
    extensions_metadata: List[Dict],
    seed: str,
    count_requested: int,
    compress: bool,
) -> None:
    """Create a manifest file with information about the downloaded extensions."""
    manifest = {
        "download_date": datetime.now().isoformat(),
        "seed": seed,
        "requested_count": count_requested,
        "downloaded_count": len(extensions_metadata),
        "compressed": compress,
        "total_size_bytes": sum(ext["total_size_bytes"] for ext in extensions_metadata),
        "extensions": extensions_metadata,
    }

    manifest_path = output_dir / "manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n✓ Manifest created: {manifest_path}")


def print_summary(extensions_metadata: List[Dict], compress: bool) -> None:
    """Print a summary of the download."""
    total_size = sum(ext["total_size_bytes"] for ext in extensions_metadata)
    avg_size = total_size / len(extensions_metadata) if extensions_metadata else 0

    print("\n" + "=" * 60)
    print("Download Summary")
    print("=" * 60)
    print(f"Extensions downloaded:  {len(extensions_metadata)}")
    print(f"Total size:            {format_bytes(total_size)}")
    print(f"Average size:          {format_bytes(avg_size)}")
    print(f"Format:                {'Compressed (tar.gz)' if compress else 'Directories'}")

    if extensions_metadata:
        # Find largest extension
        largest = max(extensions_metadata, key=lambda x: x["total_size_bytes"])
        print(
            f"Largest extension:     {largest['name']} ({format_bytes(largest['total_size_bytes'])})"
        )

        # Calculate score statistics
        scores = [
            ext["interestingness_score"]
            for ext in extensions_metadata
            if ext.get("interestingness_score") is not None
        ]
        if scores:
            avg_score = sum(scores) / len(scores)
            print(f"Avg interestingness:   {avg_score:.2f}")

    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(
        description="Download random migrated extensions from MongoDB.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Local mode (files on same machine as MongoDB)
  python download_random_extensions.py ./extensions --count 100

  # Remote mode (download via SCP from remote server)
  python download_random_extensions.py ./extensions --count 100 \\
    --ssh-host ra24mif@kuria.plai.ifi.lmu.de \\
    --ssh-port 54321 \\
    --ssh-options "-o PreferredAuthentications=password"
        """
    )
    parser.add_argument(
        "output_dir",
        type=str,
        nargs="?",
        default="./downloaded_extensions",
        help="Output directory for downloaded extensions (default: ./downloaded_extensions)",
    )
    parser.add_argument(
        "--uri",
        type=str,
        default=DEFAULT_URI,
        help=f"MongoDB URI (default: {DEFAULT_URI})",
    )
    parser.add_argument(
        "--db", type=str, default=DEFAULT_DB, help=f"Database name (default: {DEFAULT_DB})"
    )
    parser.add_argument(
        "--seed",
        type=str,
        default=None,
        help="Random seed for reproducible selection (default: auto-generated)",
    )
    parser.add_argument(
        "--count",
        type=int,
        default=100,
        help="Number of extensions to download (default: 100)",
    )
    parser.add_argument(
        "--compress",
        action="store_true",
        help="Create tar.gz archives instead of copying directories",
    )
    parser.add_argument(
        "--ssh-host",
        type=str,
        default=None,
        help="SSH host for remote downloads (e.g., user@host.com). If not specified, assumes local files.",
    )
    parser.add_argument(
        "--ssh-port",
        type=int,
        default=22,
        help="SSH port (default: 22)",
    )
    parser.add_argument(
        "--ssh-options",
        type=str,
        default="-o PreferredAuthentications=password",
        help='Additional SSH options (default: "-o PreferredAuthentications=password")',
    )
    parser.add_argument(
        "--path-map",
        type=str,
        action="append",
        default=None,
        help='Path prefix mapping for translating DB paths to filesystem paths (format: "from:to"). Can be specified multiple times for different prefixes.',
    )
    parser.add_argument(
        "--mv3-only",
        action="store_true",
        help="Download only MV3 (migrated) versions, skip MV2 originals",
    )
    parser.add_argument(
        "--all-tested",
        action="store_true",
        help="Download all extensions that have been tested (ignores --count and --seed)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Number of parallel download workers (default: 8)",
    )

    args = parser.parse_args()

    # Parse path mappings (list of tuples)
    path_map = None
    if args.path_map:
        path_map = []
        for entry in args.path_map:
            try:
                from_path, to_path = entry.split(":", 1)
                path_map.append((from_path, to_path))
                print(f"Path mapping: {from_path} -> {to_path}")
            except ValueError:
                print(f"Error: Invalid path-map format '{entry}'. Use 'from:to' format.")
                sys.exit(1)
    output_dir = Path(args.output_dir)

    # Generate seed if not provided
    seed = args.seed if args.seed else generate_seed()

    print("=" * 60)
    print("Extension Downloader")
    print("=" * 60)
    print(f"Output directory: {output_dir}")
    if args.all_tested:
        print(f"Mode:            All tested extensions")
    else:
        print(f"Count:           {args.count}")
        print(f"Seed:            {seed}")
    print(f"Compress:        {args.compress}")
    if args.ssh_host:
        print(f"Mode:            Remote (SSH)")
        print(f"SSH Host:        {args.ssh_host}")
        print(f"SSH Port:        {args.ssh_port}")
    else:
        print(f"Mode:            Local")
    print("=" * 60 + "\n")

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Connect to database
    client = connect_to_db(args.uri)

    try:
        # Fetch extensions
        if args.all_tested:
            print("\nFetching all tested extensions...")
            extensions = get_all_tested_extensions(client, args.db)
        else:
            print(f"\nFetching {args.count} random extensions...")
            extensions = get_random_extensions(client, args.db, args.count, seed)

        if not extensions:
            print("✗ No extensions found")
            sys.exit(1)

        print(f"✓ Found {len(extensions)} extensions to download\n")

        # Download extensions
        total = len(extensions)
        print(f"Downloading extensions with {args.workers} parallel workers...")
        extensions_metadata = []
        counter_lock = threading.Lock()
        completed = [0]

        def download_one(extension, control_path=None):
            metadata = copy_extension(
                extension,
                output_dir,
                args.compress,
                ssh_host=args.ssh_host,
                ssh_port=args.ssh_port,
                ssh_options=args.ssh_options,
                control_path=control_path,
                path_map=path_map,
                mv3_only=args.mv3_only,
            )
            with counter_lock:
                completed[0] += 1
                n = completed[0]
            if metadata:
                print(f"[{n}/{total}] ✓ {metadata['name']} ({format_bytes(metadata['total_size_bytes'])})")
            else:
                print(f"[{n}/{total}] ✗ {extension.get('name', extension.get('id', '?'))}")
            return metadata

        if args.ssh_host:
            with SSHConnectionManager(args.ssh_host, args.ssh_port, args.ssh_options) as ssh_manager:
                control_path = ssh_manager.get_control_path()
                with ThreadPoolExecutor(max_workers=args.workers) as pool:
                    futures = {pool.submit(download_one, ext, control_path): ext for ext in extensions}
                    for future in as_completed(futures):
                        metadata = future.result()
                        if metadata:
                            extensions_metadata.append(metadata)
        else:
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = {pool.submit(download_one, ext): ext for ext in extensions}
                for future in as_completed(futures):
                    metadata = future.result()
                    if metadata:
                        extensions_metadata.append(metadata)

        # Create manifest
        create_manifest(
            output_dir, extensions_metadata, seed, len(extensions), args.compress
        )

        # Print summary
        print_summary(extensions_metadata, args.compress)

        if len(extensions_metadata) < len(extensions):
            failed_count = len(extensions) - len(extensions_metadata)
            print(f"\n⚠ {failed_count} extension(s) failed to download")

    finally:
        client.close()
        print("\n✓ Connection closed")


if __name__ == "__main__":
    main()
