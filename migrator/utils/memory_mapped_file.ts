import { openSync, closeSync, readSync, statSync } from 'fs';

interface MemoryMappedFile {
    buffer: Buffer | null;
    fd: number;
    size: number;
    path: string;
}

/**
 * Memory-efficient file reader with true lazy loading.
 * File content is only read into memory when first accessed via getContent() or getBuffer().
 * Memory can be released while keeping the file re-readable via releaseMemory().
 */
export class MMapFile implements MemoryMappedFile {
    buffer: Buffer | null = null;
    fd: number = -1;
    size: number;
    path: string;
    private _content?: string;
    private _loaded: boolean = false;

    constructor(filePath: string) {
        this.path = filePath;
        // Only get file size in constructor - don't read content yet (true lazy loading)
        const stats = statSync(filePath);
        this.size = stats.size;
    }

    /**
     * Ensure file content is loaded into memory.
     * Opens file, reads content, and immediately closes file descriptor.
     */
    private ensureLoaded(): void {
        if (this._loaded && this.buffer !== null) {
            return;
        }

        // Re-stat the file in case it changed on disk (e.g., updated content)
        try {
            const stats = statSync(this.path);
            if (stats.size !== this.size) {
                this.size = stats.size;
            }
        } catch {
            // If we can't stat, fall back to existing size
        }

        // Open, read, and immediately close to avoid FD leaks
        this.fd = openSync(this.path, 'r');
        try {
            // Allocate exactly the current file size
            this.buffer = Buffer.alloc(this.size);
            if (this.size > 0) {
                const bytesRead = readSync(this.fd, this.buffer, 0, this.size, 0);
                // If fewer bytes were read than the allocated buffer (file shrank), slice to exact length
                if (bytesRead < this.buffer.length) {
                    this.buffer = this.buffer.slice(0, bytesRead);
                }
            }
        } finally {
            closeSync(this.fd);
            this.fd = -1;
        }
        this._loaded = true;
    }

    /**
     * Get file content as a UTF-8 string.
     * Content is cached after first read.
     */
    getContent(): string {
        if (this._content !== undefined) {
            return this._content;
        }
        this.ensureLoaded();
        this._content = this.buffer!.toString('utf-8');
        return this._content;
    }

    /**
     * Get raw file content as a Buffer.
     */
    getBuffer(): Buffer {
        this.ensureLoaded();
        return this.buffer!;
    }

    /**
     * Release memory while keeping the file path for potential re-reading.
     * This allows the garbage collector to reclaim the buffer memory.
     * The file can still be read again after calling this method.
     */
    releaseMemory(): void {
        this.buffer = null;
        this._content = undefined;
        this._loaded = false;
    }

    /**
     * Check if file content is currently loaded in memory.
     */
    isLoaded(): boolean {
        return this._loaded && this.buffer !== null;
    }

    /**
     * Get memory usage of this file in bytes.
     * Returns 0 if content is not loaded.
     */
    getMemoryUsage(): number {
        if (!this.buffer) return 0;
        // Buffer size + approximate string size (if cached)
        let usage = this.buffer.length;
        if (this._content) {
            usage += this._content.length * 2; // UTF-16 internal representation
        }
        return usage;
    }

    /**
     * Close the file and release all resources.
     * After calling this, the file cannot be re-read.
     */
    close(): void {
        if (this.fd >= 0) {
            try {
                closeSync(this.fd);
            } catch {
                // Ignore errors on close
            }
            this.fd = -1;
        }
        this.releaseMemory();
    }
}
