import * as espree from "espree";
import * as ESTree from "estree";
import { ExtFileType } from "./ext_file_types";
import { MMapFile } from "../utils/memory_mapped_file";
import { logger } from "../utils/logger";
import { lstatSync } from "fs";
import { Extension } from "./extension";

export interface AbstractFile {
    path: string;
    filetype: ExtFileType;
    getAST(): ESTree.Node | undefined;
    getContent(): string;
    getSize(): number;
    close(): void;
}

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
                    sourceType: 'script'
                }) as ESTree.Program;
            } catch (scriptError) {
                // Fallback: try parsing as module if script parsing fails
                try {
                    this._ast = espree.parse(content, {
                        ecmaVersion: 'latest',
                        sourceType: 'module'
                    }) as ESTree.Program;
                } catch (moduleError) {
                    throw scriptError; // Throw original error
                }
            }
        } catch (error) {
            // Log parsing errors for thesis experiment
            const stats = lstatSync(this._absolutePath);
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

    cleanContent(): AbstractFile {
        this.close(); // Reuse existing close logic
        this._ast = undefined;
        this._astParsed = false;
        return this;
    }

    getSize(): number {
        return this._getMMapFile().size;
    }

    close(): void {
        if (this._mmapFile) {
            this._mmapFile.close();
            this._mmapFile = undefined;
        }
    }
}
