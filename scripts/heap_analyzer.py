import json
import os
import sys
import re
from collections import defaultdict
from typing import Dict, List, Tuple
from pathlib import Path

class HeapSnapshotAnalyzer:
    def __init__(self, directory: str = "."):
        self.directory = directory
        self.snapshots = []
        
    def find_snapshots(self) -> List[Tuple[str, int]]:
        """Find all heap snapshot files and sort them by sequence"""
        files = []
        
        # Pattern to match heap snapshot files
        patterns = [
            r'heap-start-(\d+)\.heapsnapshot',
            r'heap-after-(\d+)-extensions-(\d+)\.heapsnapshot'
        ]
        
        for filename in os.listdir(self.directory):
            if filename.endswith('.heapsnapshot'):
                filepath = os.path.join(self.directory, filename)
                
                # Try to extract sequence number
                if 'heap-start' in filename:
                    match = re.search(patterns[0], filename)
                    if match:
                        files.append((filepath, filename, -1, int(match.group(1))))
                elif 'heap-after' in filename:
                    match = re.search(patterns[1], filename)
                    if match:
                        seq = int(match.group(1))
                        timestamp = int(match.group(2))
                        files.append((filepath, filename, seq, timestamp))
        
        # Sort by sequence number, then timestamp
        files.sort(key=lambda x: (x[2], x[3]))
        
        return [(f[0], f[1]) for f in files]
    
    def parse_snapshot(self, filepath: str) -> Dict:
        """Parse a single heap snapshot file"""
        print(f"\n📊 Parsing: {os.path.basename(filepath)}")
        
        try:
            with open(filepath, 'r') as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"  ⚠️  ERROR: Invalid JSON - {str(e)}")
            print(f"  File may be corrupted or incomplete. Skipping...")
            return None
        except Exception as e:
            print(f"  ⚠️  ERROR: {str(e)}")
            return None
        
        snapshot = data.get('snapshot', {})
        meta = snapshot.get('meta', {})
        
        # Extract basic info
        node_count = snapshot.get('node_count', 0)
        edge_count = snapshot.get('edge_count', 0)
        
        # Parse nodes to get memory info
        nodes_raw = data.get('nodes', [])
        strings = data.get('strings', [])
        
        node_fields = meta.get('node_fields', [])
        node_types = meta.get('node_types', [[]])[0]
        
        # Field indices
        type_idx = node_fields.index('type') if 'type' in node_fields else 0
        name_idx = node_fields.index('name') if 'name' in node_fields else 1
        self_size_idx = node_fields.index('self_size') if 'self_size' in node_fields else 3
        
        field_count = len(node_fields)
        
        # Analyze nodes
        type_stats = defaultdict(lambda: {'count': 0, 'size': 0})
        name_stats = defaultdict(lambda: {'count': 0, 'size': 0})
        total_size = 0
        
        for i in range(0, len(nodes_raw), field_count):
            if i + field_count > len(nodes_raw):
                break
                
            node_type_idx = nodes_raw[i + type_idx]
            node_name_idx = nodes_raw[i + name_idx]
            node_size = nodes_raw[i + self_size_idx]
            
            # Get type and name strings
            node_type = node_types[node_type_idx] if node_type_idx < len(node_types) else 'unknown'
            node_name = strings[node_name_idx] if node_name_idx < len(strings) else 'unknown'
            
            type_stats[node_type]['count'] += 1
            type_stats[node_type]['size'] += node_size
            
            name_stats[node_name]['count'] += 1
            name_stats[node_name]['size'] += node_size
            
            total_size += node_size
        
        return {
            'filepath': filepath,
            'filename': os.path.basename(filepath),
            'node_count': node_count,
            'edge_count': edge_count,
            'total_size': total_size,
            'type_stats': dict(type_stats),
            'name_stats': dict(name_stats)
        }
    
    def format_bytes(self, bytes_val: int) -> str:
        """Format bytes to human readable format"""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if bytes_val < 1024.0:
                return f"{bytes_val:.2f} {unit}"
            bytes_val /= 1024.0
        return f"{bytes_val:.2f} TB"
    
    def display_snapshot_summary(self, snapshot_data: Dict):
        """Display summary of a single snapshot"""
        print(f"  Nodes: {snapshot_data['node_count']:,}")
        print(f"  Edges: {snapshot_data['edge_count']:,}")
        print(f"  Total Size: {self.format_bytes(snapshot_data['total_size'])}")
        
        print(f"\n  Top 5 Object Types by Size:")
        type_stats = sorted(snapshot_data['type_stats'].items(), 
                           key=lambda x: x[1]['size'], reverse=True)[:5]
        for type_name, stats in type_stats:
            print(f"    {type_name:20s}: {stats['count']:8,} objects, {self.format_bytes(stats['size'])}")
    
    def analyze_growth(self):
        """Analyze memory growth across all snapshots"""
        snapshot_files = self.find_snapshots()
        
        if not snapshot_files:
            print("❌ No heap snapshot files found in the directory!")
            return
        
        print(f"✓ Found {len(snapshot_files)} heap snapshot(s)\n")
        print("=" * 80)
        
        # Parse all snapshots
        results = []
        for filepath, filename in snapshot_files:
            result = self.parse_snapshot(filepath)
            if result is None:
                continue  # Skip corrupted files
            results.append(result)
            self.display_snapshot_summary(result)
            print("=" * 80)
        
        # Compare and show growth
        if len(results) == 0:
            print("\n❌ No valid heap snapshots could be parsed!")
            return
        elif len(results) == 1:
            print("\n⚠️  Only one valid snapshot found. Need multiple snapshots to analyze growth.")
            return
        elif len(results) > 1:
            print("\n📈 MEMORY GROWTH ANALYSIS")
            print("=" * 80)
            
            baseline = results[0]
            print(f"\nBaseline: {baseline['filename']}")
            print(f"  Size: {self.format_bytes(baseline['total_size'])}")
            
            for i, snapshot in enumerate(results[1:], 1):
                size_diff = snapshot['total_size'] - baseline['total_size']
                size_percent = (size_diff / baseline['total_size'] * 100) if baseline['total_size'] > 0 else 0
                node_diff = snapshot['node_count'] - baseline['node_count']
                
                print(f"\n{snapshot['filename']}:")
                print(f"  Size: {self.format_bytes(snapshot['total_size'])} "
                      f"({'+' if size_diff >= 0 else ''}{self.format_bytes(size_diff)}, "
                      f"{'+' if size_percent >= 0 else ''}{size_percent:.1f}%)")
                print(f"  Nodes: {snapshot['node_count']:,} "
                      f"({'+' if node_diff >= 0 else ''}{node_diff:,})")
            
            # Find growing object types
            print(f"\n🔍 OBJECT TYPES WITH LARGEST GROWTH:")
            print("-" * 80)
            
            baseline_types = baseline['type_stats']
            type_growth = {}
            
            for snapshot in results[1:]:
                for type_name, stats in snapshot['type_stats'].items():
                    baseline_size = baseline_types.get(type_name, {}).get('size', 0)
                    growth = stats['size'] - baseline_size
                    
                    if type_name not in type_growth or growth > type_growth[type_name]['max_growth']:
                        type_growth[type_name] = {
                            'max_growth': growth,
                            'baseline_count': baseline_types.get(type_name, {}).get('count', 0),
                            'current_count': stats['count'],
                            'baseline_size': baseline_size,
                            'current_size': stats['size']
                        }
            
            # Sort by growth and display top 10
            top_growing = sorted(type_growth.items(), key=lambda x: x[1]['max_growth'], reverse=True)[:10]
            
            for type_name, growth_data in top_growing:
                if growth_data['max_growth'] > 0:
                    count_diff = growth_data['current_count'] - growth_data['baseline_count']
                    print(f"\n{type_name}:")
                    print(f"  Growth: +{self.format_bytes(growth_data['max_growth'])}")
                    print(f"  Count: {growth_data['baseline_count']:,} → {growth_data['current_count']:,} "
                          f"(+{count_diff:,})")
                    print(f"  Size: {self.format_bytes(growth_data['baseline_size'])} → "
                          f"{self.format_bytes(growth_data['current_size'])}")
            
            # Summary
            print(f"\n" + "=" * 80)
            print("💡 SUMMARY")
            print("=" * 80)
            final = results[-1]
            total_growth = final['total_size'] - baseline['total_size']
            total_percent = (total_growth / baseline['total_size'] * 100) if baseline['total_size'] > 0 else 0
            
            print(f"Total Memory Growth: {self.format_bytes(total_growth)} ({total_percent:.1f}%)")
            print(f"From: {self.format_bytes(baseline['total_size'])} → {self.format_bytes(final['total_size'])}")
            print(f"Snapshots Analyzed: {len(results)}")
            
            if total_growth > 0:
                print(f"\n⚠️  Memory grew by {self.format_bytes(total_growth)} across snapshots.")
                print("   Check the growing object types above for potential memory leaks.")
            else:
                print(f"\n✓ Memory appears stable or decreased.")

def main():
    if len(sys.argv) > 1:
        directory = sys.argv[1]
    else:
        directory = "."
    
    if not os.path.isdir(directory):
        print(f"❌ Directory not found: {directory}")
        sys.exit(1)
    
    analyzer = HeapSnapshotAnalyzer(directory)
    analyzer.analyze_growth()

if __name__ == "__main__":
    main()
