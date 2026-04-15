import * as espree from 'espree';
import * as ESTree from 'estree';
import { ExtFileType } from './ext_file_types';
import { MMapFile } from '../utils/memory_mapped_file';
import { logger } from '../utils/logger';
import { lstatSync } from 'fs';

export interface AbstractFile {
    path: string;
    filetype: ExtFileType;
    getAST(): ESTree.Node | undefined;
    getContent(): string;
    getBuffer(): Buffer;
    getSize(): number;
    close(): void;
    releaseMemory(): void;
    cleanContent(): AbstractFile;
}

/**
 * Lazy-loading file implementation that defers reading until content is accessed.
 * Supports memory release for long-running processes to prevent OOM.
 */
export class LazyFile implements AbstractFile {
    path: string;
    filetype: ExtFileType;
    private _mmapFile?: MMapFile;
    private _ast?: ESTree.Node;
    private _astParsed = false;
    private _absolutePath: string;

    constructor(relativePath: string, absolutePath: string, fileType: ExtFileType) {
        this.path = relativePath;
        this._absolutePath = absolutePath;
        this.filetype = fileType;
        // Don't open file descriptor until needed
    }

    private _getMMapFile(): MMapFile {
        if (!this._mmapFile) {
            this._mmapFile = new MMapFile(this._absolutePath);
        }
        return this._mmapFile;
    }

    getAST(): ESTree.Node | undefined {
        if (this._astParsed) {
            return this._ast;
        }

        this._astParsed = true;

        // Only parse JavaScript files
        if (this.filetype !== ExtFileType.JS) {
            return undefined;
        }

        try {
            const content = this.getContent();

            // Use Espree with modern JavaScript support and error tolerance
            try {
                this._ast = espree.parse(content, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true,
                } as any) as ESTree.Program;
            } catch (scriptError) {
                // Fallback: try parsing as module if script parsing fails
                try {
                    this._ast = espree.parse(content, {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        loc: true,
                        range: true,
                    } as any) as ESTree.Program;
                } catch {
                    throw scriptError; // Throw original error
                }
            }
        } catch (error) {
            // Log parsing errors for thesis experiment
            lstatSync(this._absolutePath);
            logger.error(null, this.path, String(error));

            // Reduce verbose error logging for performance
            if (process.env.DEBUG) {
                console.warn(`Failed to parse JavaScript file ${this.path}:`, error);
            }
        }

        return this._ast;
    }

    getContent(): string {
        return this._getMMapFile().getContent();
    }

    getBuffer(): Buffer {
        return this._getMMapFile().getBuffer();
    }

    /**
     * Release memory used by this file while keeping it re-readable.
     * The file content can be read again after calling this method.
     * Use this for long-running processes to prevent memory exhaustion.
     */
    releaseMemory(): void {
        if (this._mmapFile) {
            this._mmapFile.releaseMemory();
        }
        this._ast = undefined;
        this._astParsed = false;
    }

    /**
     * Clean cached content and AST.
     * @deprecated Use releaseMemory() for better semantics
     */
    cleanContent(): AbstractFile {
        this.releaseMemory();
        return this;
    }

    getSize(): number {
        return this._getMMapFile().size;
    }

    /**
     * Check if file content is currently loaded in memory.
     */
    isLoaded(): boolean {
        return this._mmapFile?.isLoaded() ?? false;
    }

    /**
     * Get approximate memory usage of this file in bytes.
     */
    getMemoryUsage(): number {
        let usage = this._mmapFile?.getMemoryUsage() ?? 0;
        // Add estimate for AST if cached (rough estimate: 10x the source size)
        if (this._ast && this._mmapFile) {
            usage += this._mmapFile.size * 10;
        }
        return usage;
    }

    /**
     * Close the file and release all resources.
     * After calling this, the file content cannot be accessed.
     */
    close(): void {
        if (this._mmapFile) {
            this._mmapFile.close();
            this._mmapFile = undefined;
        }
        this._ast = undefined;
        this._astParsed = false;
    }
}

/**
 * Create a transformed file that wraps new content without reading from disk.
 * Used by transformation modules to create in-memory file representations.
 *
 * @param originalFile - The original file being transformed (will have its memory released)
 * @param newContent - The new content for the transformed file
 * @returns A new AbstractFile with the transformed content
 */
export function createTransformedFile(
    originalFile: AbstractFile,
    newContent: string
): AbstractFile {
    // Use a wrapper object so content can be released later
    let contentRef: { content: string; buffer: Buffer | null } | null = {
        content: newContent,
        buffer: null, // Lazily create buffer only when needed
    };
    let cachedAST: ESTree.Node | undefined;
    let astParsed = false;

    const transformedFile: AbstractFile = {
        path: originalFile.path,
        filetype: originalFile.filetype,

        getContent(): string {
            if (!contentRef) {
                throw new Error(`File content has been released: ${originalFile.path}`);
            }
            return contentRef.content;
        },

        getBuffer(): Buffer {
            if (!contentRef) {
                throw new Error(`File content has been released: ${originalFile.path}`);
            }
            // Lazily create buffer to avoid double memory usage
            if (!contentRef.buffer) {
                contentRef.buffer = Buffer.from(contentRef.content, 'utf8');
            }
            return contentRef.buffer;
        },

        getSize(): number {
            if (!contentRef) {
                return 0;
            }
            return contentRef.buffer ? contentRef.buffer.length : Buffer.byteLength(contentRef.content, 'utf8');
        },

        getAST(): ESTree.Node | undefined {
            if (astParsed) {
                return cachedAST;
            }
            astParsed = true;

            if (originalFile.filetype !== ExtFileType.JS) {
                return undefined;
            }

            if (!contentRef) {
                return undefined;
            }

            try {
                cachedAST = espree.parse(contentRef.content, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true,
                } as any) as ESTree.Program;
            } catch {
                try {
                    cachedAST = espree.parse(contentRef.content, {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        loc: true,
                        range: true,
                    } as any) as ESTree.Program;
                } catch {
                    // Parsing failed
                }
            }

            return cachedAST;
        },

        close(): void {
            // Release all memory
            contentRef = null;
            cachedAST = undefined;
            astParsed = false;
        },

        releaseMemory(): void {
            // Clear AST cache but keep content for potential re-use
            cachedAST = undefined;
            astParsed = false;
            // Release buffer to save memory (can be recreated from content)
            if (contentRef) {
                contentRef.buffer = null;
            }
        },

        cleanContent(): AbstractFile {
            cachedAST = undefined;
            astParsed = false;
            if (contentRef) {
                contentRef.buffer = null;
            }
            return transformedFile;
        },
    };

    // Release the original file's memory since we now have transformed content
    if (originalFile.releaseMemory) {
        originalFile.releaseMemory();
    }

    return transformedFile;
}

/**
 * Create a new in-memory file from scratch.
 * Used for generating new files that don't exist on disk (e.g., rules.json, bridge.js, offscreen.html).
 *
 * @param path - The relative path for the new file
 * @param content - The file content
 * @param filetype - The file type (ExtFileType)
 * @returns A new AbstractFile with the content
 */
export function createNewFile(
    path: string,
    content: string,
    filetype: ExtFileType
): AbstractFile {
    // Use a wrapper object so content can be released later
    let contentRef: { content: string; buffer: Buffer | null } | null = {
        content,
        buffer: null, // Lazily create buffer only when needed
    };
    let cachedAST: ESTree.Node | undefined;
    let astParsed = false;

    const newFile: AbstractFile = {
        path,
        filetype,

        getContent(): string {
            if (!contentRef) {
                throw new Error(`File content has been released: ${path}`);
            }
            return contentRef.content;
        },

        getBuffer(): Buffer {
            if (!contentRef) {
                throw new Error(`File content has been released: ${path}`);
            }
            // Lazily create buffer to avoid double memory usage
            if (!contentRef.buffer) {
                contentRef.buffer = Buffer.from(contentRef.content, 'utf8');
            }
            return contentRef.buffer;
        },

        getSize(): number {
            if (!contentRef) {
                return 0;
            }
            return contentRef.buffer ? contentRef.buffer.length : Buffer.byteLength(contentRef.content, 'utf8');
        },

        getAST(): ESTree.Node | undefined {
            if (astParsed) {
                return cachedAST;
            }
            astParsed = true;

            if (filetype !== ExtFileType.JS) {
                return undefined;
            }

            if (!contentRef) {
                return undefined;
            }

            try {
                cachedAST = espree.parse(contentRef.content, {
                    ecmaVersion: 'latest',
                    sourceType: 'script',
                    loc: true,
                    range: true,
                } as any) as ESTree.Program;
            } catch {
                try {
                    cachedAST = espree.parse(contentRef.content, {
                        ecmaVersion: 'latest',
                        sourceType: 'module',
                        loc: true,
                        range: true,
                    } as any) as ESTree.Program;
                } catch {
                    // Parsing failed
                }
            }

            return cachedAST;
        },

        close(): void {
            // Release all memory
            contentRef = null;
            cachedAST = undefined;
            astParsed = false;
        },

        releaseMemory(): void {
            // Clear AST cache but keep content for potential re-use
            cachedAST = undefined;
            astParsed = false;
            // Release buffer to save memory (can be recreated from content)
            if (contentRef) {
                contentRef.buffer = null;
            }
        },

        cleanContent(): AbstractFile {
            cachedAST = undefined;
            astParsed = false;
            if (contentRef) {
                contentRef.buffer = null;
            }
            return newFile;
        },
    };

    return newFile;
}
