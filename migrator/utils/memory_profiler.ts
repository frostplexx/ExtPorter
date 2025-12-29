// migrator/utils/memory_profiler.ts
import * as v8 from 'v8';
import * as fs from 'fs';
import * as path from 'path';

export class MemoryProfiler {
    /**
     * Take a heap snapshot and save to disk
     */
    static takeHeapSnapshot(label: string = 'snapshot'): string {
        const filename = `heap-${label}-${Date.now()}.heapsnapshot`;
        const filepath = path.join(process.cwd(), 'logs', filename);
        
        console.log(`Taking heap snapshot: ${filename}`);
        const snapshot = v8.writeHeapSnapshot(filepath);
        console.log(`Heap snapshot saved: ${snapshot}`);
        
        return snapshot;
    }

    /**
     * Get heap statistics
     */
    static getHeapStats(): v8.HeapSpaceStatistics[] {
        return v8.getHeapSpaceStatistics();
    }

    /**
     * Print detailed heap stats
     */
    static printHeapStats(): void {
        const stats = v8.getHeapSpaceStatistics();
        console.log('\n=== Heap Statistics ===');
        stats.forEach(space => {
            console.log(`${space.space_name}:`);
            console.log(`  Size: ${(space.space_size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Used: ${(space.space_used_size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Available: ${(space.space_available_size / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Physical: ${(space.physical_space_size / 1024 / 1024).toFixed(2)} MB`);
        });
        console.log('======================\n');
    }
}
