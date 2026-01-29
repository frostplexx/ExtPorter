#!/usr/bin/env python3
"""
Create a JSON mapping of MV2 extension folder names to MV3 extension folder names.

Queries the database to build a mapping from the original MV2 source folder names
to their migrated MV3 extension folder names.

Output format:
    {
        "mv2_folder_name": "mv3_folder_name",
        ...
    }

Usage:
    python create_folder_mapping.py [output.json] [--uri URI] [--db DB]

Requirements:
    pip install pymongo python-dotenv
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, Optional

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
EXTENSIONS_COLLECTION = "extensions"


def connect_to_db(uri: str) -> Optional[MongoClient]:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        sys.exit(1)


def get_folder_name(path: Optional[str]) -> Optional[str]:
    """Extract the folder name from a path."""
    if not path:
        return None
    return Path(path).name


def create_mapping(client: MongoClient, db_name: str) -> Dict[str, str]:
    """
    Create a mapping of MV2 folder names to MV3 folder names.

    Returns:
        Dict mapping mv2_folder_name -> mv3_folder_name
    """
    db = client[db_name]
    collection = db[EXTENSIONS_COLLECTION]

    mapping: Dict[str, str] = {}
    skipped = 0
    processed = 0

    # Query for extensions that have both paths
    cursor = collection.find(
        {},
        {
            "manifest_v2_path": 1,
            "manifest_v3_path": 1,
            "mv3_extension_id": 1,
            "id": 1,
            "name": 1,
        }
    )

    for ext in cursor:
        processed += 1

        # Get MV2 folder name from manifest_v2_path (original source folder)
        mv2_path = ext.get("manifest_v2_path")
        mv2_folder_name = get_folder_name(mv2_path)

        # Get MV3 folder name - prefer manifest_v3_path, fall back to mv3_extension_id
        mv3_path = ext.get("manifest_v3_path")
        mv3_folder_name = get_folder_name(mv3_path)

        # If no mv3_path, try mv3_extension_id (the generated MV3 ID used as folder name)
        if not mv3_folder_name:
            mv3_folder_name = ext.get("mv3_extension_id")

        # Skip if we don't have both
        if not mv2_folder_name or not mv3_folder_name:
            skipped += 1
            continue

        # Map: MV2 folder name -> MV3 folder name
        mapping[mv2_folder_name] = mv3_folder_name

    print(f"Processed {processed} extensions")
    print(f"Skipped {skipped} (missing MV2 or MV3 path)")
    print(f"Created {len(mapping)} mappings (MV2 -> MV3)")

    return mapping


def main():
    # Load .env file if available
    if load_dotenv:
        script_dir = Path(__file__).parent
        for env_path in [script_dir / ".env", script_dir.parent / ".env"]:
            if env_path.exists():
                load_dotenv(env_path)
                print(f"Loaded environment from: {env_path}")
                break

    parser = argparse.ArgumentParser(
        description="Create a JSON mapping of MV2 folder names to MV3 folder names."
    )
    parser.add_argument(
        "output",
        type=str,
        nargs="?",
        default="folder_mapping.json",
        help="Output JSON file path (default: folder_mapping.json)",
    )
    parser.add_argument(
        "--uri",
        type=str,
        default=os.environ.get("MONGODB_URI", DEFAULT_URI),
        help=f"MongoDB URI (default: from MONGODB_URI env var or {DEFAULT_URI})",
    )
    parser.add_argument(
        "--db",
        type=str,
        default=os.environ.get("DB_NAME", DEFAULT_DB),
        help=f"Database name (default: from DB_NAME env var or {DEFAULT_DB})",
    )
    parser.add_argument(
        "--pretty",
        action="store_true",
        help="Pretty print the JSON output with indentation",
    )

    args = parser.parse_args()
    output_path = Path(args.output)

    print("Connecting to MongoDB...")
    client = connect_to_db(args.uri)

    try:
        print(f"Querying '{args.db}.{EXTENSIONS_COLLECTION}'...")
        mapping = create_mapping(client, args.db)

        # Write the mapping to JSON
        with open(output_path, "w", encoding="utf-8") as f:
            if args.pretty:
                json.dump(mapping, f, indent=2, ensure_ascii=False)
            else:
                json.dump(mapping, f, ensure_ascii=False)

        print(f"\nMapping written to: {output_path}")

    finally:
        client.close()

    print("Done.")


if __name__ == "__main__":
    main()
