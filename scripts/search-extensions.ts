#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import { Database, Collections } from '../migrator/features/database/db_manager';
import { Extension } from '../migrator/types/extension';
import { spawn } from 'child_process';

// Load environment variables
dotenv.config();

class ExtensionSearcher {
    async getAllExtensions(): Promise<Extension[]> {
        if (!Database.shared.database) throw new Error('Database not initialized');

        // Get all extensions from the single extensions collection
        const allExtensions = await Database.shared.database.collection(Collections.EXTENSIONS).find({}).toArray();

        return allExtensions.map(ext => ({
            id: ext.id,
            name: ext.name || ext.manifest?.name || 'Unknown',
            manifest_v2_path: ext.manifest_v2_path || '',
            manifest: ext.manifest || {},
            files: ext.files || [],
            isNewTabExtension: ext.isNewTabExtension,
            mv3_extension_id: ext.mv3_extension_id
        }));
    }

    formatExtensionForFzf(ext: Extension): string {
        const name = ext.name || ext.manifest?.name || 'Unknown';
        const description = ext.manifest?.description || 'No description';
        const version = ext.manifest?.version || 'Unknown version';

        // Show both MV2 and MV3 IDs
        const mv2Id = `MV2: ${ext.id}`;
        const mv3Id = ext.mv3_extension_id ? ` | MV3: ${ext.mv3_extension_id}` : ' | MV3: none';

        // Truncate long descriptions to make room for both IDs
        const truncatedDesc = description.length > 60
            ? description.substring(0, 57) + '...'
            : description;

        return `${mv2Id}${mv3Id} | ${name} | v${version} | ${truncatedDesc}`;
    }

    async searchWithFzf(extensions: Extension[]) {
        const fzfInput = extensions
            .map(ext => this.formatExtensionForFzf(ext))
            .join('\n');

        const fzf = spawn('fzf', [
            '--height=40%',
            '--layout=reverse',
            '--border',
            '--prompt=Search Extensions: ',
            '--preview=echo {}',
            '--preview-window=down:3:wrap',
            '--bind=enter:accept',
            '--header=Use arrow keys to navigate, Enter to select, Esc to quit'
        ], {
            stdio: ['pipe', 'pipe', 'inherit']
        });

        fzf.stdin.write(fzfInput);
        fzf.stdin.end();

        return new Promise<string>((resolve, reject) => {
            let output = '';

            fzf.stdout.on('data', (data) => {
                output += data.toString();
            });

            fzf.on('close', (code) => {
                if (code === 0) {
                    const selectedLine = output.trim();
                    if (selectedLine) {
                        // Extract MV2 ID from the formatted line (MV2: xxxxx | MV3: yyyyy | ...)
                        const mv2Match = selectedLine.match(/MV2: ([^\s|]+)/);
                        if (mv2Match) {
                            const extensionId = mv2Match[1];
                            const selectedExtension = extensions.find(ext => ext.id === extensionId);
                            if (selectedExtension) {
                                this.displayExtensionDetails(selectedExtension);
                            }
                        }
                    }
                    resolve(selectedLine);
                } else if (code === 130) {
                    // User pressed Esc
                    console.log('\nSearch cancelled');
                    resolve('');
                } else {
                    reject(new Error(`fzf exited with code ${code}`));
                }
            });

            fzf.on('error', (err) => {
                if (err.message.includes('ENOENT')) {
                    console.error('Error: fzf not found. Please install fzf first.');
                    console.error('On macOS: brew install fzf');
                    console.error('On Ubuntu: sudo apt install fzf');
                } else {
                    console.error('Error running fzf:', err.message);
                }
                reject(err);
            });
        });
    }

    displayExtensionDetails(ext: Extension) {
        console.log('\n' + '='.repeat(70));
        console.log('EXTENSION DETAILS');
        console.log('='.repeat(70));
        console.log(`Manifest V2 ID: ${ext.id}`);

        if (ext.mv3_extension_id) {
            console.log(`Manifest V3 ID: ${ext.mv3_extension_id}`);
        } else {
            console.log(`Manifest V3 ID: Not migrated`);
        }

        console.log(`Name: ${ext.name || ext.manifest?.name || 'Unknown'}`);
        console.log(`Version: ${ext.manifest?.version || 'Unknown'}`);
        console.log(`Description: ${ext.manifest?.description || 'No description'}`);

        if (ext.manifest?.manifest_version) {
            console.log(`Manifest Version: ${ext.manifest.manifest_version}`);
        }

        if (ext.manifest) {
            console.log('\nManifest Keys:');
            Object.keys(ext.manifest).forEach(key => {
                if (!['name', 'description', 'version', 'manifest_version'].includes(key)) {
                    console.log(`  - ${key}`);
                }
            });
        }

        console.log('='.repeat(70));
    }

}

async function main() {
    const searcher = new ExtensionSearcher();

    try {
        await Database.shared.init();

        console.log('Loading extensions...');
        const extensions = await searcher.getAllExtensions();

        if (extensions.length === 0) {
            console.log('No extensions found in database');
            return;
        }

        console.log(`Found ${extensions.length} extensions`);
        console.log('Starting search interface...\n');

        await searcher.searchWithFzf(extensions);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await Database.shared.close();
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}