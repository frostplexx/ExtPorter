"""
Count and categorize migration rules in the ExtPorter migration system.

Usage:
    python scripts/count_migration_rules.py [--json] [--verbose]

Options:
    --json      Output results as JSON
    --verbose   Include detailed listings of all rules
"""

import json
import re
import argparse
from pathlib import Path
from collections import defaultdict
from typing import Dict, List, Any


def load_api_mappings(repo_root: Path) -> Dict[str, Any]:
    """Load API mappings from JSON file."""
    api_mappings_path = repo_root / "migrator" / "templates" / "api_mappings.json"
    try:
        with open(api_mappings_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Warning: Could not load api_mappings.json: {e}")
        return {"mappings": []}


def load_blacklist_patterns(repo_root: Path) -> Dict[str, Any]:
    """Load transformation blacklist patterns from JSON file."""
    blacklist_path = repo_root / "migrator" / "templates" / "transformation_blacklist.json"
    try:
        with open(blacklist_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Warning: Could not load transformation_blacklist.json: {e}")
        return {"blacklist_patterns": []}


def analyze_api_mappings(mappings: List[Dict]) -> Dict[str, Any]:
    """Analyze API mappings and group by namespace."""
    namespace_counts = defaultdict(int)
    namespace_details = defaultdict(list)

    for mapping in mappings:
        source_body = mapping.get("source", {}).get("body", "")

        # Extract namespace from source.body (e.g., chrome.extension.connect -> extension)
        match = re.search(r'chrome\.(\w+)\.', source_body)
        if match:
            namespace = match.group(1)
            namespace_counts[namespace] += 1

            # Extract method/property name
            method_match = re.search(r'chrome\.\w+\.(\w+)', source_body)
            method_name = method_match.group(1) if method_match else "unknown"

            target_body = mapping.get("target", {}).get("body", "")
            namespace_details[namespace].append({
                "source": source_body.strip(),
                "target": target_body.strip(),
                "method": method_name
            })

    return {
        "total": len(mappings),
        "by_namespace": dict(namespace_counts),
        "details": dict(namespace_details)
    }


def scan_manifest_transformations(repo_root: Path) -> List[str]:
    """Scan manifest module for transformation functions."""
    manifest_path = repo_root / "migrator" / "modules" / "manifest" / "index.ts"
    transformations = []

    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # Look for key transformation function names
        transformation_patterns = [
            "splitPermissions",
            "addDeclarativeNetRequest",
            "migrateWebAccessibleResources",
            "migrateActions",
            "migrateBackground"
        ]

        for pattern in transformation_patterns:
            if pattern in content:
                transformations.append(pattern)

    except Exception as e:
        print(f"Warning: Could not scan manifest transformations: {e}")

    return transformations


def scan_migration_modules(repo_root: Path) -> List[Dict[str, str]]:
    """Scan migration modules directory."""
    modules_dir = repo_root / "migrator" / "modules"
    modules = []

    # Module descriptions based on exploration
    module_descriptions = {
        "manifest": "Manifest v2→v3 transformations",
        "api_renames": "API rename transformations",
        "web_request_migrator": "webRequest→declarativeNetRequest",
        "csp": "Content Security Policy transformations",
        "offscreen_document_migrator": "DOM/window API migrations",
        "bridge_injector": "Callback compatibility layer",
        "resource_downloader": "Remote resource localization",
        "listener_analyzer": "Event listener extraction",
        "interestingness_scorer": "Extension complexity scoring",
        "write_migrated": "Extension output writer"
    }

    try:
        for module_dir in sorted(modules_dir.iterdir()):
            if module_dir.is_dir() and (module_dir / "index.ts").exists():
                module_name = module_dir.name
                description = module_descriptions.get(module_name, "Migration module")
                modules.append({
                    "name": module_name,
                    "description": description,
                    "path": str(module_dir.relative_to(repo_root))
                })
    except Exception as e:
        print(f"Warning: Could not scan migration modules: {e}")

    return modules


def categorize_blacklist_patterns(patterns: List[Dict]) -> Dict[str, List[Dict]]:
    """Categorize blacklist patterns by type."""
    categories = defaultdict(list)

    for pattern in patterns:
        pattern_str = pattern.get("pattern", "")
        reason = pattern.get("reason", "")

        # Categorize based on pattern and reason
        if any(lib in pattern_str.lower() for lib in ["jquery", "react", "vue", "angular", "d3", "three", "lodash", "moment", "bootstrap", "chart", "ace", "codemirror", "monaco", "polyfill", "babel", "core-js"]):
            categories["library_files"].append(pattern)
        elif ".min.js" in pattern_str:
            categories["minified_files"].append(pattern)
        elif any(dir in pattern_str for dir in ["dist/", "build/", "webpack", "bundle", "chunk", "runtime"]):
            categories["build_artifacts"].append(pattern)
        elif any(dir in pattern_str for dir in ["vendor/", "lib/", "libs/", "node_modules/"]):
            categories["vendor_dirs"].append(pattern)
        else:
            categories["other"].append(pattern)

    return dict(categories)


def format_text_output(data: Dict[str, Any], verbose: bool = False) -> str:
    """Format results as human-readable text."""
    output = []
    output.append("ExtPorter Migration Rules Summary")
    output.append("=" * 50)
    output.append("")

    # API Migrations
    api_data = data["api_mappings"]
    output.append(f"API Migrations ({api_data['total']} rules)")
    output.append("-" * 50)
    for namespace, count in sorted(api_data["by_namespace"].items()):
        output.append(f"  chrome.{namespace}.*".ljust(30) + f"{count} mappings")
    output.append("")

    if verbose and api_data["details"]:
        output.append("  Detailed API Mappings:")
        for namespace, mappings in sorted(api_data["details"].items()):
            output.append(f"    chrome.{namespace}.*:")
            for m in mappings[:5]:  # Show first 5
                output.append(f"      - {m['method']}")
            if len(mappings) > 5:
                output.append(f"      ... and {len(mappings) - 5} more")
        output.append("")

    # Manifest Transformations
    manifest_data = data["manifest_transformations"]
    output.append(f"Manifest Transformations ({len(manifest_data)} transformations)")
    output.append("-" * 50)
    transformation_names = {
        "splitPermissions": "Permission Splitting",
        "addDeclarativeNetRequest": "Declarative Net Request Configuration",
        "migrateWebAccessibleResources": "Web Accessible Resources Migration",
        "migrateActions": "Action Consolidation",
        "migrateBackground": "Background Service Worker Migration"
    }
    for i, transform in enumerate(manifest_data, 1):
        name = transformation_names.get(transform, transform)
        output.append(f"  {i}. {name}")
    output.append("")

    # Other Migration Modules
    modules = data["migration_modules"]
    # Exclude core modules (manifest, api_renames) from "other" count
    other_modules = [m for m in modules if m["name"] not in ["manifest", "api_renames"]]
    output.append(f"Other Migration Modules ({len(other_modules)} modules)")
    output.append("-" * 50)
    for i, module in enumerate(other_modules, 1):
        name = module["name"].replace("_", " ").title()
        desc = module["description"]
        output.append(f"  {i}. {name} - {desc}")
    output.append("")

    # Transformation Blacklist
    blacklist_data = data["blacklist_patterns"]
    total_patterns = blacklist_data["total"]
    output.append(f"Transformation Blacklist ({total_patterns} patterns)")
    output.append("-" * 50)
    category_names = {
        "library_files": "Library files",
        "minified_files": "Minified files",
        "build_artifacts": "Build artifacts",
        "vendor_dirs": "Vendor directories",
        "other": "Other"
    }
    for category, patterns in sorted(blacklist_data["categories"].items()):
        name = category_names.get(category, category)
        output.append(f"  {name}:".ljust(25) + f"{len(patterns)} patterns")
    output.append("")

    # Summary
    output.append("=" * 50)
    output.append("TOTAL MIGRATION CAPABILITIES: " + str(data["summary"]["total"]))
    output.append("  - API Mappings: " + str(api_data["total"]))
    output.append("  - Manifest Transformations: " + str(len(manifest_data)))
    output.append("  - Other Modules: " + str(len(other_modules)))
    output.append("  - Blacklist Patterns: " + str(total_patterns))

    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(
        description="Count and categorize migration rules in ExtPorter"
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Include detailed listings of all rules"
    )
    args = parser.parse_args()

    # Determine repository root (script is in /scripts/)
    script_dir = Path(__file__).parent
    repo_root = script_dir.parent

    # Load data
    api_mappings_data = load_api_mappings(repo_root)
    blacklist_data = load_blacklist_patterns(repo_root)

    # Analyze
    api_analysis = analyze_api_mappings(api_mappings_data.get("mappings", []))
    manifest_transformations = scan_manifest_transformations(repo_root)
    migration_modules = scan_migration_modules(repo_root)
    blacklist_categories = categorize_blacklist_patterns(
        blacklist_data.get("blacklist_patterns", [])
    )

    # Calculate other modules (exclude manifest and api_renames from count)
    other_modules = [m for m in migration_modules if m["name"] not in ["manifest", "api_renames"]]

    # Build result
    result = {
        "api_mappings": api_analysis,
        "manifest_transformations": manifest_transformations,
        "migration_modules": migration_modules,
        "blacklist_patterns": {
            "total": len(blacklist_data.get("blacklist_patterns", [])),
            "categories": blacklist_categories
        },
        "summary": {
            "total": (
                api_analysis["total"] +
                len(manifest_transformations) +
                len(other_modules) +
                len(blacklist_data.get("blacklist_patterns", []))
            ),
            "breakdown": {
                "api_mappings": api_analysis["total"],
                "manifest_transformations": len(manifest_transformations),
                "other_modules": len(other_modules),
                "blacklist_patterns": len(blacklist_data.get("blacklist_patterns", []))
            }
        }
    }

    # Output
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(format_text_output(result, verbose=args.verbose))


if __name__ == "__main__":
    main()
