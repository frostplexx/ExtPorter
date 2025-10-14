import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { ExtensionSearchResult, CommandResult } from './types';

export function getMv2Path(ext: ExtensionSearchResult): string | null {
    if (!ext.manifest_v2_path) return null;

    const mv2Path = ext.manifest_v2_path.endsWith('manifest.json')
        ? path.dirname(ext.manifest_v2_path)
        : ext.manifest_v2_path;

    return fs.existsSync(mv2Path) ? mv2Path : null;
}

export function getMv3Path(ext: ExtensionSearchResult): string | null {
    if (ext.manifest_v3_path) {
        const mv3Path = path.dirname(ext.manifest_v3_path);
        if (fs.existsSync(mv3Path)) return mv3Path;
    }

    if (ext.mv3_extension_id && process.env.OUTPUT_DIR) {
        const fallbackPath = path.join(process.env.OUTPUT_DIR, ext.mv3_extension_id);
        if (fs.existsSync(fallbackPath)) return fallbackPath;
    }

    return null;
}

export async function execCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const proc = spawn(command, args, { stdio: 'pipe' });
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Command exited with code ${code}`));
        });
        proc.on('error', reject);
    });
}

export async function runCommand(
    command: string,
    args: string[],
    showOutput: boolean = false,
    background: boolean = false
): Promise<CommandResult> {
    return new Promise((resolve) => {
        try {
            if (background) {
                // Run in background
                const proc = spawn(command, args, {
                    detached: true,
                    stdio: 'ignore'
                });
                proc.unref();
                resolve({ success: true, output: '' });
                return;
            }

            const proc = spawn(command, args, {
                stdio: showOutput ? 'inherit' : 'pipe'
            });

            let output = '';
            let error = '';

            if (!showOutput) {
                proc.stdout?.on('data', (data) => {
                    output += data.toString();
                });

                proc.stderr?.on('data', (data) => {
                    error += data.toString();
                });
            }

            proc.on('close', (code) => {
                resolve({
                    success: code === 0,
                    output,
                    error: error || undefined
                });
            });

            proc.on('error', (err) => {
                resolve({
                    success: false,
                    output: '',
                    error: err.message
                });
            });
        } catch (err: any) {
            resolve({
                success: false,
                output: '',
                error: err.message
            });
        }
    });
}

export function collectExtensionFiles(mv2Path: string): { path: string; content: string }[] {
    const codeFiles: { path: string; content: string }[] = [];

    // 1. Add manifest.json
    const manifestPath = path.join(mv2Path, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        return codeFiles;
    }

    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    codeFiles.push({ path: 'extension/manifest.json', content: manifestContent });

    // Parse manifest to find important files
    try {
        const manifest = JSON.parse(manifestContent);

        // 2. Collect background scripts
        if (manifest.background) {
            const scripts = manifest.background.scripts || (manifest.background.service_worker ? [manifest.background.service_worker] : []);
            for (const script of scripts) {
                if (script) {
                    const scriptPath = path.join(mv2Path, script);
                    if (fs.existsSync(scriptPath)) {
                        const content = fs.readFileSync(scriptPath, 'utf8');
                        codeFiles.push({ path: `extension/${script}`, content });
                    }
                }
            }
            // Also check for page property
            if (manifest.background.page) {
                const pagePath = path.join(mv2Path, manifest.background.page);
                if (fs.existsSync(pagePath)) {
                    const content = fs.readFileSync(pagePath, 'utf8');
                    codeFiles.push({ path: `extension/${manifest.background.page}`, content });
                }
            }
        }

        // 3. Collect content scripts
        if (manifest.content_scripts) {
            for (const cs of manifest.content_scripts) {
                if (cs.js) {
                    for (const jsFile of cs.js) {
                        const jsPath = path.join(mv2Path, jsFile);
                        if (fs.existsSync(jsPath)) {
                            const content = fs.readFileSync(jsPath, 'utf8');
                            codeFiles.push({ path: `extension/${jsFile}`, content });
                        }
                    }
                }
            }
        }

        // 4. Collect popup HTML and its scripts
        const popupPath = manifest.browser_action?.default_popup || manifest.action?.default_popup;
        if (popupPath) {
            const fullPopupPath = path.join(mv2Path, popupPath);
            if (fs.existsSync(fullPopupPath)) {
                const content = fs.readFileSync(fullPopupPath, 'utf8');
                codeFiles.push({ path: `extension/${popupPath}`, content });

                // Parse HTML to find script tags
                const scriptMatches = content.matchAll(/<script[^>]*src=["']([^"']+)["']/g);
                for (const match of scriptMatches) {
                    const scriptFile = match[1];
                    const scriptPath = path.join(mv2Path, path.dirname(popupPath), scriptFile);
                    if (fs.existsSync(scriptPath)) {
                        const scriptContent = fs.readFileSync(scriptPath, 'utf8');
                        const relativePath = path.join(path.dirname(popupPath), scriptFile);
                        codeFiles.push({ path: `extension/${relativePath}`, content: scriptContent });
                    }
                }
            }
        }

        // 5. Collect options page
        const optionsPage = manifest.options_page || manifest.options_ui?.page;
        if (optionsPage) {
            const optionsPath = path.join(mv2Path, optionsPage);
            if (fs.existsSync(optionsPath)) {
                const content = fs.readFileSync(optionsPath, 'utf8');
                codeFiles.push({ path: `extension/${optionsPage}`, content });
            }
        }

        // 6. Collect chrome_url_overrides (new tab, history, bookmarks)
        if (manifest.chrome_url_overrides) {
            for (const [key, value] of Object.entries(manifest.chrome_url_overrides)) {
                const overridePath = path.join(mv2Path, value as string);
                if (fs.existsSync(overridePath)) {
                    const content = fs.readFileSync(overridePath, 'utf8');
                    codeFiles.push({ path: `extension/${value}`, content });
                }
            }
        }

        // 7. Look for common main files if we don't have much yet
        if (codeFiles.length < 5) {
            const commonFiles = ['main.js', 'index.js', 'app.js', 'background.js', 'content.js', 'script.js'];
            for (const commonFile of commonFiles) {
                const commonPath = path.join(mv2Path, commonFile);
                if (fs.existsSync(commonPath) && !codeFiles.some(f => f.path.includes(commonFile))) {
                    const content = fs.readFileSync(commonPath, 'utf8');
                    codeFiles.push({ path: `extension/${commonFile}`, content });
                }
            }
        }
    } catch (e) {
        console.log('⚠ Could not parse manifest.json');
    }

    return codeFiles;
}
