#!/usr/bin/env python3
"""
Map the extensions listed in an experiment-results CSV back to their MV2 extension IDs
using the ExtPorter server dataset.

Every row's `extension_id` is resolved against the `extensions` collection by ID:
first against `id`, then against `mv3_extension_id` (the ID of the migrated build).
The `matched_by` column says which one hit.

IMPORTANT: neither of those fields is the Chrome Web Store ID. getExtensionID() in
migrator/utils/find_extensions.ts derives `Extension.id` as sha256(<extension dir>)
mapped into a-z, so it looks like a CWS ID but is synthetic. The real CWS ID -- the one
on chrome-stats and on the files -- is the extension's directory name, so `mv2_id` is
taken from `manifest_v2_path`. Run with --check-ids to verify that derivation.

Unlike name/version matching this is exact: the CSV's 500 IDs are unique, including the
extensions that share a name and version (e.g. the 8 'Firebase Auth ... Sample' rows).

The MongoDB connection goes through the SSH bridge, so start it first:
    ./scripts/ssh_bridge.sh user@remote-host 27017 27017

Usage:
    python map_reports_to_mv2_ids.py [input_csv] [-o output_csv] [--uri URI] [--db DB]
                                     [--unresolved-only] [--names]

Example:
    python map_reports_to_mv2_ids.py \
        "data/experiment_results/500 Extensions-Extension Reports.csv" \
        -o mv2_ids.csv

Requirements:
    pip install pymongo
"""

import argparse
import csv
import hashlib
import os
import sys
from typing import Dict, List, Optional

try:
    from pymongo import MongoClient
except ImportError:
    print("Error: pymongo is not installed. Run: pip install pymongo")
    sys.exit(1)


DEFAULT_URI = os.environ.get(
    "MONGODB_URI", "mongodb://admin:password@localhost:27017/migrator?authSource=admin"
)
DEFAULT_DB = os.environ.get("DB_NAME", "migrator")
EXTENSIONS_COLLECTION = "extensions"

ID_COLUMN = "extension_id"
NAME_COLUMN = "extension_name"
VERSION_COLUMN = "extension_version"


def connect_to_db(uri: str) -> MongoClient:
    """Connect to MongoDB and return the client."""
    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        print("Connected to MongoDB")
        return client
    except Exception as e:
        print(f"Error connecting to MongoDB: {e}")
        print("Is the SSH bridge running? See scripts/ssh_bridge.sh")
        sys.exit(1)


def read_csv_rows(path: str) -> List[Dict[str, str]]:
    """Read the CSV rows, keeping ID, name and version. One output row per CSV row."""
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None or ID_COLUMN not in reader.fieldnames:
            print(f"Error: {path} has no '{ID_COLUMN}' column")
            sys.exit(1)

        rows = []
        for row in reader:
            ext_id = (row.get(ID_COLUMN) or "").strip()
            if not ext_id:
                continue
            rows.append(
                {
                    ID_COLUMN: ext_id,
                    NAME_COLUMN: (row.get(NAME_COLUMN) or "").strip(),
                    VERSION_COLUMN: (row.get(VERSION_COLUMN) or "").strip(),
                }
            )

    print(f"Read {len(rows)} rows ({len({r[ID_COLUMN] for r in rows})} unique IDs) from {path}")
    return rows


def fetch_by_ids(
    client: MongoClient, db_name: str, ids: List[str], batch_size: int = 500
) -> Dict[str, Dict]:
    """Fetch dataset extensions whose `id` or `mv3_extension_id` is in `ids`.

    Returns a lookup keyed by BOTH fields, so a CSV ID resolves whichever it is.
    """
    collection = client[db_name][EXTENSIONS_COLLECTION]
    projection = {
        "id": 1,
        "mv3_extension_id": 1,
        "name": 1,
        "version": 1,
        "manifest_v2_path": 1,
        "manifest_v3_path": 1,
    }

    by_id: Dict[str, Dict] = {}
    docs = 0
    for i in range(0, len(ids), batch_size):
        batch = ids[i : i + batch_size]
        query = {"$or": [{"id": {"$in": batch}}, {"mv3_extension_id": {"$in": batch}}]}
        for doc in collection.find(query, projection):
            docs += 1
            if doc.get("id"):
                by_id.setdefault(doc["id"], doc)
            if doc.get("mv3_extension_id"):
                by_id.setdefault(doc["mv3_extension_id"], doc)

    print(f"Fetched {docs} dataset documents")
    return by_id


def synthetic_id(extension_dir: str) -> str:
    """Reproduce getExtensionID() from migrator/utils/find_extensions.ts."""
    digest = hashlib.sha256(extension_dir.encode()).hexdigest()[:32]
    return "".join(chr(97 + (int(c, 16) % 26)) for c in digest)


def cws_id_from_path(manifest_v2_path: str) -> str:
    """The real Chrome Web Store ID: the name of the extension's directory.

    `Extension.id` is NOT the CWS ID -- getExtensionID() in
    migrator/utils/find_extensions.ts derives it as sha256(<dir path>) mapped into
    a-z, so it merely looks like one. The CWS ID is the directory name itself.
    """
    path = (manifest_v2_path or "").rstrip("/")
    if path.endswith("/manifest.json"):
        path = path[: -len("/manifest.json")]
    return os.path.basename(path)


def resolve(rows: List[Dict[str, str]], by_id: Dict[str, Dict]) -> List[Dict[str, object]]:
    """Resolve each CSV row to its MV2 (Chrome Web Store) ID, recording what matched."""
    results = []
    for row in rows:
        csv_id = row[ID_COLUMN]
        doc: Optional[Dict] = by_id.get(csv_id)

        if doc is None:
            matched_by = "none"
        elif doc.get("id") == csv_id:
            matched_by = "id"
        elif doc.get("mv3_extension_id") == csv_id:
            matched_by = "mv3_extension_id"
        else:
            matched_by = "unknown"

        results.append(
            {
                "csv_extension_id": csv_id,
                "mv2_id": cws_id_from_path((doc or {}).get("manifest_v2_path", "")),
                "internal_id": (doc or {}).get("id", "") or "",
                "mv3_id": (doc or {}).get("mv3_extension_id", "") or "",
                "matched_by": matched_by,
                "dataset_name": (doc or {}).get("name", "") or "",
                "dataset_version": (doc or {}).get("version", "") or "",
                "csv_name": row[NAME_COLUMN],
                "csv_version": row[VERSION_COLUMN],
                "manifest_v2_path": (doc or {}).get("manifest_v2_path", "") or "",
            }
        )
    return results


def write_csv(results: List[Dict[str, object]], path: str, with_names: bool) -> None:
    fields = ["mv2_id", "matched_by"]
    if with_names:
        fields += ["dataset_name", "dataset_version"]

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(results)

    print(f"Wrote {len(results)} rows to {path}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Map CSV extension IDs back to MV2 IDs via the ExtPorter dataset."
    )
    parser.add_argument(
        "input_csv",
        nargs="?",
        default="data/experiment_results/500 Extensions-Extension Reports.csv",
        help="Input CSV (default: data/experiment_results/500 Extensions-Extension Reports.csv)",
    )
    parser.add_argument(
        "-o",
        "--output",
        default="mv2_ids.csv",
        help="Output CSV path (default: mv2_ids.csv)",
    )
    parser.add_argument("--uri", default=DEFAULT_URI, help=f"MongoDB URI (default: {DEFAULT_URI})")
    parser.add_argument("--db", default=DEFAULT_DB, help=f"Database name (default: {DEFAULT_DB})")
    parser.add_argument(
        "--unresolved-only",
        action="store_true",
        help="Only write rows that could not be resolved to an MV2 ID",
    )
    parser.add_argument(
        "--names",
        action="store_true",
        help="Also write the dataset's real name/version columns",
    )
    parser.add_argument(
        "--check-ids",
        action="store_true",
        help="Verify that each dataset `id` really is sha256(manifest_v2_path) mapped "
        "into a-z, i.e. that mv2_id was taken from the right place",
    )
    parser.add_argument(
        "--diff-only",
        action="store_true",
        help="Only write rows whose CSV name or version differs from the dataset "
        "(implies --names; use this to backfill the real values)",
    )
    args = parser.parse_args()

    rows = read_csv_rows(args.input_csv)
    client = connect_to_db(args.uri)
    try:
        by_id = fetch_by_ids(client, args.db, sorted({r[ID_COLUMN] for r in rows}))
    finally:
        client.close()

    results = resolve(rows, by_id)

    via_id = [r for r in results if r["matched_by"] == "id"]
    via_mv3 = [r for r in results if r["matched_by"] == "mv3_extension_id"]
    missing = [r for r in results if r["matched_by"] == "none"]
    resolved = [r for r in results if r["matched_by"] != "none"]
    name_diff = [
        r for r in resolved if r["csv_name"] and r["csv_name"] != r["dataset_name"]
    ]
    version_diff = [
        r
        for r in resolved
        if r["dataset_version"] and r["csv_version"] != r["dataset_version"]
    ]
    diff_ids = {r["csv_extension_id"] for r in name_diff + version_diff}
    diffs = [r for r in resolved if r["csv_extension_id"] in diff_ids]

    if args.unresolved_only:
        out_rows = missing
    elif args.diff_only:
        out_rows = diffs
    else:
        out_rows = results
    write_csv(out_rows, args.output, args.names or args.diff_only)

    print()
    print(f"Total rows:                    {len(results)}")
    print(f"CSV ID was already the MV2 ID: {len(via_id)}")
    print(f"Reversed from mv3_extension_id:{len(via_mv3)}")
    print(f"Unresolved:                    {len(missing)}")
    print(f"Name differs from dataset:     {len(name_diff)}")
    print(f"Version differs from dataset:  {len(version_diff)}")

    no_path = [r for r in resolved if not r["mv2_id"]]
    if no_path:
        print(f"Resolved but no CWS ID (no manifest_v2_path): {len(no_path)}")

    if args.check_ids:
        bad = [
            r
            for r in resolved
            if r["mv2_id"]
            and synthetic_id(by_id[r["csv_extension_id"]].get("manifest_v2_path", ""))
            != r["internal_id"]
        ]
        print(
            f"ID derivation check:           {len(resolved) - len(bad)}/{len(resolved)} "
            f"dataset ids == sha256(manifest_v2_path)"
        )
        for r in bad[:10]:
            print(f"  - mismatch for {r['mv2_id']} (internal {r['internal_id']})")
    if missing:
        print("\nFirst unresolved IDs:")
        for r in missing[:10]:
            print(f"  - {r['csv_extension_id']}  ({r['csv_name'] or 'no name'})")
    if diffs:
        print("\nReal values from the dataset (CSV -> dataset):")
        for r in diffs[:40]:
            print(f"  {r['mv2_id']}")
            print(f"    name:    {r['csv_name']!r} -> {r['dataset_name']!r}")
            print(f"    version: {r['csv_version']!r} -> {r['dataset_version']!r}")
        if len(diffs) > 40:
            print(f"  ... and {len(diffs) - 40} more (see {args.output})")


if __name__ == "__main__":
    main()
