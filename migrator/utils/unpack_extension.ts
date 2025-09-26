import { execSync } from "child_process";
import { Extension } from "../types/extension";
import { LazyFile } from "../types/abstract_file";
import { ExtFileType } from "../types/ext_file_types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { MMapFile } from "./memory_mapped_file";

/**
 * Unpacks a CRX extension file and returns the extension data
 * @param{string} crxPath path to the .crx file
 * @returns{Extension[]} list of extensions (typically one)
 */
export function unpack_extension(crxPath: string): Extension[] {
    let crxMMapFile: MMapFile | undefined;
    let manifestMMapFile: MMapFile | undefined;
    let tempDir: string | undefined;

    try {
        // Create temporary directory for extraction
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crx-extract-'));

        // Read the CRX file using memory mapping
        crxMMapFile = new MMapFile(crxPath);
        const crxBuffer = crxMMapFile.getBuffer();

        // CRX files start with "Cr24" magic number, followed by version and key/signature lengths
        if (crxBuffer.toString('ascii', 0, 4) !== 'Cr24') {
            throw new Error(`Invalid CRX file format: ${crxPath}`);
        }

        // Skip CRX header to get to the ZIP data
        // CRX v2: magic(4) + version(4) + pubkey_len(4) + sig_len(4) + pubkey + signature
        // CRX v3: magic(4) + version(4) + header_len(4) + header + remainder is ZIP
        const version = crxBuffer.readUInt32LE(4);
        let zipStart = 0;

        if (version === 2) {
            const pubkeyLen = crxBuffer.readUInt32LE(8);
            const sigLen = crxBuffer.readUInt32LE(12);
            zipStart = 16 + pubkeyLen + sigLen;
        } else if (version === 3) {
            const headerLen = crxBuffer.readUInt32LE(8);
            zipStart = 12 + headerLen;
        } else {
            throw new Error(`Unsupported CRX version: ${version}`);
        }

        // Extract ZIP portion and save to temporary file
        const zipBuffer = crxBuffer.subarray(zipStart);
        const tempZipPath = path.join(tempDir, 'extension.zip');
        fs.writeFileSync(tempZipPath, zipBuffer);

        // Extract ZIP file
        execSync(`unzip -q "${tempZipPath}" -d "${tempDir}" 2>/dev/null`, { encoding: 'utf-8' });

        // Clean up temporary ZIP file
        fs.unlinkSync(tempZipPath);

        // Read manifest.json
        const manifestPath = path.join(tempDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            throw new Error(`No manifest.json found in CRX file: ${crxPath}`);
        }

        // Read manifest using memory mapping
        manifestMMapFile = new MMapFile(manifestPath);
        const manifestContent = manifestMMapFile.getContent();
        const manifest = JSON.parse(manifestContent);

        // Determine manifest version
        const manifestVersion = manifest.manifest_version || 'unknown';

        // Scan the extracted directory for all files
        const files = scanExtensionFiles(tempDir);

        // Create Extension object
        const extension: Extension = {
            id: manifest.id || `${(manifest.name || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}_${Date.now()}`,
            name: manifest.name || 'Unknown Extension',
            manifest_path: manifestPath,
            manifest: manifest,
            files: files
        };

        return [extension];

    } catch (error) {
        throw new Error(`Failed to unpack CRX file: ${crxPath}. Error: ${error}`);
    } finally {
        // Ensure all file descriptors are always closed
        if (crxMMapFile) {
            crxMMapFile.close();
        }
        if (manifestMMapFile) {
            manifestMMapFile.close();
        }
    }
}

function scanExtensionFiles(extractedDir: string): LazyFile[] {
    const files: LazyFile[] = [];

    function scanDirectory(dirPath: string, relativePath: string = '') {
        try {
            const entries = fs.readdirSync(dirPath);

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry);
                const relativeEntryPath = relativePath ? path.join(relativePath, entry) : entry;

                // Skip manifest.json as it's handled separately
                if (entry === 'manifest.json' && relativePath === '') {
                    continue;
                }

                const stats = fs.lstatSync(fullPath);

                if (stats.isFile()) {
                    const fileType = getFileType(entry);
                    const lazyFile = new LazyFile(relativeEntryPath, fullPath, fileType);
                    files.push(lazyFile);
                } else if (stats.isDirectory()) {
                    // Recursively scan subdirectories
                    scanDirectory(fullPath, relativeEntryPath);
                }
            }
        } catch (error) {
            console.warn(`Error scanning directory ${dirPath}: ${error}`);
        }
    }

    scanDirectory(extractedDir);
    return files;
}

function getFileType(filename: string): ExtFileType {
    const ext = path.extname(filename).toLowerCase();

    switch (ext) {
        case '.js':
            return ExtFileType.JS;
        case '.css':
            return ExtFileType.CSS;
        case '.html':
        case '.htm':
            return ExtFileType.HTML;
        default:
            return ExtFileType.OTHER;
    }
}
