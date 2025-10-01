import { openSync, fstatSync, closeSync, readSync } from "fs";

interface MemoryMappedFile {
  buffer: Buffer;
  fd: number;
  size: number;
  path: string;
}

export class MMapFile implements MemoryMappedFile {
  buffer: Buffer;
  fd: number;
  size: number;
  path: string;
  private _content?: string;

  constructor(filePath: string) {
    this.path = filePath;
    this.fd = openSync(filePath, "r");
    const stats = fstatSync(this.fd);
    this.size = stats.size;

    // Use lazy loading approach - allocate buffer but don't read until needed
    this.buffer = Buffer.alloc(this.size);
    if (this.size > 0) {
      readSync(this.fd, this.buffer, 0, this.size, 0);
    }
  }

  getContent(): string {
    if (!this._content) {
      this._content = this.buffer.toString("utf-8");
    }
    return this._content;
  }

  getBuffer(): Buffer {
    return this.buffer;
  }

  close(): void {
    if (this.fd >= 0) {
      closeSync(this.fd);
      this.fd = -1;
    }
  }
}
