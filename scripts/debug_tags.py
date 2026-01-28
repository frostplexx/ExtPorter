#!/usr/bin/env python3
"""Quick debug: count how many migrated extensions have each tag."""
import os, sys
from collections import Counter
from pathlib import Path
try:
    from dotenv import load_dotenv
    for p in [Path(__file__).parent / ".env", Path(__file__).parent.parent / ".env"]:
        if p.exists(): load_dotenv(p); break
except ImportError: pass
from pymongo import MongoClient

uri = os.environ.get("MONGODB_URI", "mongodb://admin:password@localhost:27017/migrator?authSource=admin")
client = MongoClient(uri, serverSelectionTimeoutMS=5000)
db = client[os.environ.get("DB_NAME", "migrator")]

exts = list(db["extensions"].find({"mv3_extension_id": {"$exists": True, "$ne": None}}, {"tags": 1}))
print(f"Total migrated: {len(exts)}")

tag_counts = Counter()
for e in exts:
    for t in e.get("tags", []):
        tag_counts[t] += 1

print(f"\nTag counts:")
for tag, count in tag_counts.most_common():
    pct = round(count / len(exts) * 100, 1)
    print(f"  {tag:45s} {count:6d}  ({pct}%)")

# How many have NEITHER API_RENAMES_APPLIED NOR BRIDGE_INJECTED?
neither = sum(1 for e in exts if "API_RENAMES_APPLIED" not in e.get("tags", []) and "BRIDGE_INJECTED" not in e.get("tags", []))
print(f"\nNeither API_RENAMES_APPLIED nor BRIDGE_INJECTED: {neither} ({round(neither/len(exts)*100,1)}%)")

client.close()
