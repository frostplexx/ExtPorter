#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import { Database, Collections } from '../migrator/features/database/db_manager';
import { Extension } from '../migrator/types/extension';
import { ChromeTester } from '../ext_tester/chrome_tester';
import { spawn, execSync } from 'child_process';
import { exit } from 'process';
import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import stringWidth from 'string-width';
// @ts-ignore - no types available for inquirer-search-list
import inquirerSearchList from 'inquirer-search-list';

// Register the search list prompt
inquirer.registerPrompt('search-list', inquirerSearchList);

// Load environment variables
dotenv.config();

// Extension already has all the fields we need, just use it directly
type ExtensionSearchResult = Extension;

interface SearchOptions {
    minScore?: number;
    hasMv3?: boolean;
    noMv3?: boolean;
    permission?: string;
    pattern?: string;
    nameFilter?: string;
}

class ExtensionExplorer {
    constructor() {}

    async getAllExtensions(options: SearchOptions = {}): Promise<ExtensionSearchResult[]> {
        if (!Database.shared.database) throw new Error('Database not initialized');

        const query: any = {};

        // Apply filters
        if (options.minScore !== undefined) {
            query.interestingness_score = { $gte: options.minScore };
        }

        if (options.hasMv3) {
            query.mv3_extension_id = { $exists: true, $ne: null };
        }

        if (options.noMv3) {
            query.$or = [{ mv3_extension_id: { $exists: false } }, { mv3_extension_id: null }];
        }

        if (options.permission) {
            query['manifest.permissions'] = { $in: [options.permission] };
        }

        if (options.nameFilter) {
            query.$or = [
                { name: { $regex: options.nameFilter, $options: 'i' } },
                { 'manifest.name': { $regex: options.nameFilter, $options: 'i' } },
                { 'manifest.description': { $regex: options.nameFilter, $options: 'i' } },
            ];
        }

        const allExtensions = await Database.shared.database
            .collection(Collections.EXTENSIONS)
            .find(query)
            .toArray();

        return allExtensions.map((ext) => ({
            id: ext.id,
            name: ext.name || ext.manifest?.name || 'Unknown',
            manifest_v2_path: ext.manifest_v2_path || '',
            manifest: ext.manifest || {},
            files: ext.files || [],
            isNewTabExtension: ext.isNewTabExtension,
            mv3_extension_id: ext.mv3_extension_id,
            manifest_v3_path: ext.manifest_v3_path,
            interestingness_score: ext.interestingness_score || 0,
            interestingness_breakdown: ext.interestingness_breakdown,
        }));
    }

    formatExtensionForFzf(ext: ExtensionSearchResult): string {
        // Use fixed widths for proper alignment
        const rawName = ext.name || ext.manifest?.name || 'Unknown';
        const name = this.truncateAndPad(rawName, 35);

        const score = String(ext.interestingness_score || 0).padStart(4);

        const rawDesc = ext.manifest?.description || '';
        const description = this.truncateAndPad(rawDesc, 60);

        const mv3Status = ext.mv3_extension_id ? chalk.green('✓') : chalk.red('✗');
        const id = this.truncateAndPad(ext.id, 32);

        return `${chalk.cyan(name)}  ${chalk.yellow(score)}  ${mv3Status}  ${chalk.dim(description)}  ${chalk.gray(id)}`;
    }

    private truncateAndPad(str: string, maxLength: number): string {
        // Remove any existing color codes for width calculation
        const cleanStr = str.replace(/\x1b\[[0-9;]*m/g, '');
        const width = stringWidth(cleanStr);

        if (width <= maxLength) {
            // Pad with spaces to ensure consistent width
            const padding = ' '.repeat(maxLength - width);
            return str + padding;
        }

        // Truncate carefully to respect display width
        let truncated = '';
        let currentWidth = 0;

        for (const char of cleanStr) {
            const charWidth = stringWidth(char);
            if (currentWidth + charWidth > maxLength - 1) {
                break;
            }
            truncated += char;
            currentWidth += charWidth;
        }

        return truncated + '…' + ' '.repeat(Math.max(0, maxLength - currentWidth - 1));
    }

    createFzfPreview(ext: ExtensionSearchResult): string {
        const lines: string[] = [];

        lines.push('═'.repeat(70));
        lines.push(`📦 ${ext.name || ext.manifest?.name || 'Unknown Extension'}`);
        lines.push('═'.repeat(70));
        lines.push('');

        lines.push(`🆔 MV2 ID: ${ext.id}`);
        if (ext.mv3_extension_id) {
            lines.push(`🆔 MV3 ID: ${ext.mv3_extension_id} ✓`);
        } else {
            lines.push(`🆔 MV3 ID: Not migrated ✗`);
        }

        lines.push('');
        lines.push(`📝 Version: ${ext.manifest?.version || 'Unknown'}`);
        lines.push(`📄 Description: ${ext.manifest?.description || 'No description'}`);

        if (ext.interestingness_score !== undefined) {
            lines.push('');
            lines.push(`⭐ Interestingness Score: ${ext.interestingness_score}`);

            if (ext.interestingness_breakdown) {
                lines.push('');
                lines.push('Score Breakdown:');
                Object.entries(ext.interestingness_breakdown)
                    .filter(([_, value]) => value > 0)
                    .sort(([_, a], [__, b]) => b - a)
                    .forEach(([key, value]) => {
                        lines.push(`  • ${key.replace(/_/g, ' ')}: ${value}`);
                    });
            }
        }

        if (ext.manifest?.permissions && ext.manifest.permissions.length > 0) {
            lines.push('');
            lines.push('🔑 Permissions:');
            ext.manifest.permissions.slice(0, 10).forEach((perm: string) => {
                lines.push(`  • ${perm}`);
            });
            if (ext.manifest.permissions.length > 10) {
                lines.push(`  ... and ${ext.manifest.permissions.length - 10} more`);
            }
        }

        return lines.join('\n');
    }

    async searchWithInquirer(extensions: ExtensionSearchResult[]): Promise<ExtensionSearchResult | null> {
        const sortedExtensions = extensions.sort(
            (a, b) => (b.interestingness_score || 0) - (a.interestingness_score || 0)
        );

        const choices = sortedExtensions.map((ext) => ({
            name: this.formatExtensionForFzf(ext),
            value: ext.id,
            short: ext.name || ext.manifest?.name || 'Unknown',
        }));

        try {
            const answer = await inquirer.prompt([
                {
                    type: 'search-list',
                    name: 'extensionId',
                    message: 'Search Extensions (type to filter):',
                    choices,
                    pageSize: 20,
                    loop: false,
                },
            ] as any);

            const selected = sortedExtensions.find((ext) => ext.id === answer.extensionId);
            return selected || null;
        } catch (error) {
            // User cancelled with Ctrl+C
            return null;
        }
    }

    async showActionsMenu(ext: ExtensionSearchResult): Promise<string> {
        console.clear();
        console.log('');
        console.log(chalk.bold.cyan(`  ${ext.name || 'Unknown Extension'}`));
        console.log(chalk.dim(`  ${ext.id}${ext.mv3_extension_id ? chalk.green(' → ' + ext.mv3_extension_id) : ''}`));
        console.log('');

        const choices = [
            { name: chalk.blue('  ') + ' View Source', value: 'v' },
            { name: chalk.magenta('  ') + ' Compare Versions', value: 'c' },
            { name: chalk.green('  ') + ' Run Extension', value: 'r' },
            { name: chalk.cyan('  ') + ' Info', value: 'i' },
            { name: chalk.yellow('  ') + ' Logs', value: 'l' },
            { name: chalk.white('  ') + ' Grep', value: 'g' },
            { name: chalk.gray('  ') + ' Manifest', value: 'm' },
            { name: chalk.blue('  ') + ' Open Directory', value: 'o' },
            { name: chalk.dim('  ') + ' Search Again', value: 's' },
            { name: chalk.red('  ') + ' Quit', value: 'q' },
        ];

        try {
            const answer = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'action',
                    message: 'Action (j/k to navigate, ESC to go back):',
                    choices,
                    pageSize: 15,
                    loop: true,
                },
            ]);

            return answer.action;
        } catch (error) {
            // User pressed ESC or Ctrl+C - go back to search
            return 's';
        }
    }

    async viewSource(ext: ExtensionSearchResult): Promise<void> {
        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        if (!mv2Path && !mv3Path) {
            console.log('❌ No extension files found');
            return;
        }

        try {
            if (mv2Path && mv3Path) {
                console.log(`Opening Kitty with MV2 (left) and MV3 (right)...`);

                // Create new tab with MV2
                await this.execCommand(
                    'kitten',
                    [
                        '@', 'launch', '--type=tab',
                        '--tab-title', `${ext.name} (MV2 ↔ MV3)`,
                        '--cwd', mv2Path,
                        '--title', `MV2: ${ext.id}`,
                    ]
                );

                // Add MV3 split
                await this.execCommand(
                    'kitten',
                    [
                        '@', 'launch', '--location', 'vsplit',
                        '--cwd', mv3Path,
                        '--title', `MV3: ${ext.mv3_extension_id}`,
                    ]
                );
            } else if (mv2Path) {
                console.log(`Opening Kitty with MV2 only...`);
                await this.execCommand(
                    'kitten',
                    ['@', 'launch', '--type=tab', '--cwd', mv2Path, '--title', `MV2: ${ext.id}`]
                );
            } else if (mv3Path) {
                console.log(`Opening Kitty with MV3 only...`);
                await this.execCommand(
                    'kitten',
                    ['@', 'launch', '--type=tab', '--cwd', mv3Path, '--title', `MV3: ${ext.mv3_extension_id}`]
                );
            }

            console.log('✓ Opened in Kitty terminal');
        } catch (error: any) {
            if (error.message?.includes('ENOENT')) {
                console.log('❌ Kitty terminal not found. Showing paths instead:');
                if (mv2Path) console.log(`  MV2: ${mv2Path}`);
                if (mv3Path) console.log(`  MV3: ${mv3Path}`);
            } else {
                console.log('❌ Error opening Kitty:', error.message);
            }
        }
    }

    async compareExtensions(ext: ExtensionSearchResult): Promise<void> {
        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        if (!mv2Path) {
            console.log('❌ No MV2 version available for comparison');
            return;
        }

        if (!mv3Path) {
            console.log('❌ No MV3 version available for comparison');
            return;
        }

        console.log('🚀 Launching Chrome browsers...');
        console.log('   🔴 Red browser = MV3');
        console.log('   🔵 Blue browser = MV2');

        const { find_extensions } = await import('../migrator/utils/find_extensions');

        // Parse both extensions from filesystem to get proper Extension objects with LazyFiles
        const mv2Extensions = find_extensions(mv2Path, true);
        const mv3Extensions = find_extensions(mv3Path, true);

        if (!mv2Extensions || mv2Extensions.length === 0) {
            console.log('❌ Could not parse MV2 extension');
            return;
        }

        if (!mv3Extensions || mv3Extensions.length === 0) {
            console.log('❌ Could not parse MV3 extension');
            return;
        }

        const mv2Extension = mv2Extensions[0];
        const mv3Extension = mv3Extensions[0];

        const mv3Tester = new ChromeTester();
        const mv2Tester = new ChromeTester();

        await Promise.all([
            (async () => {
                console.log('Starting MV3 browser (red)...');
                await mv3Tester.initBrowser(mv3Extension, 3, true);
                await mv3Tester.injectColor('red');
                await mv3Tester.navigateTo('https://www.nytimes.com/');
            })(),
            (async () => {
                console.log('Starting MV2 browser (blue)...');
                await mv2Tester.initBrowser(mv2Extension, 3, true);
                await mv2Tester.injectColor('blue');
                await mv2Tester.navigateTo('https://www.nytimes.com/');
            })(),
        ]);

        console.log('✓ Both browsers launched successfully');
        console.log('  Close the browsers when done...');
    }

    async runExtension(ext: ExtensionSearchResult): Promise<void> {
        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        const choices = [];
        if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
        if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });
        choices.push({ name: 'Back to menu', value: 'b' });

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Which version would you like to run?',
                choices,
            },
        ]);

        const choice = answer.choice;

        let pathToRun: string | null = null;

        if (choice === '2' && mv2Path) {
            pathToRun = mv2Path;
        } else if (choice === '3' && mv3Path) {
            pathToRun = mv3Path;
        } else if (choice === 'b') {
            return;
        } else {
            console.log('❌ Invalid choice or version not available');
            return;
        }

        console.log(`🚀 Launching Chrome with extension from: ${pathToRun}`);

        try {
            const tempDir = execSync('mktemp -d').toString().trim();
            console.log(`Using temporary profile: ${tempDir}`);

            const chromeProcess = spawn(
                'google-chrome-stable',
                [
                    '--enable-extensions',
                    `--user-data-dir=${tempDir}`,
                    `--load-extension=${pathToRun}`,
                    '--no-first-run',
                    '--no-default-browser-check',
                    `--disable-extensions-except=${pathToRun}`,
                ],
                { stdio: 'inherit' }
            );

            chromeProcess.on('close', () => {
                console.log('Cleaning up temporary profile...');
                execSync(`rm -rf "${tempDir}"`);
                console.log('✓ Done');
            });
        } catch (error: any) {
            console.log('❌ Error launching Chrome:', error.message);
        }
    }

    async showInfo(ext: ExtensionSearchResult): Promise<void> {
        console.clear();
        console.log('');
        console.log(chalk.bold.cyan('  EXTENSION DETAILS'));
        console.log('');
        console.log(chalk.bold('Name: ') + chalk.cyan(ext.name || ext.manifest?.name || 'Unknown'));
        console.log(chalk.bold('Version: ') + chalk.yellow(ext.manifest?.version || 'Unknown'));
        console.log(chalk.bold('MV2 ID: ') + chalk.gray(ext.id));

        if (ext.mv3_extension_id) {
            console.log(chalk.bold('MV3 ID: ') + chalk.green(ext.mv3_extension_id));
        } else {
            console.log(chalk.bold('MV3 ID: ') + chalk.red('Not migrated'));
        }

        console.log('');
        console.log(chalk.bold('Description: ') + chalk.dim(ext.manifest?.description || 'No description'));

        if (ext.interestingness_score !== undefined) {
            console.log('');
            console.log(chalk.yellow('⭐ Interestingness Score: ') + chalk.bold(ext.interestingness_score.toString()));

            if (ext.interestingness_breakdown) {
                console.log('');
                console.log(chalk.bold('Score Breakdown:'));
                Object.entries(ext.interestingness_breakdown)
                    .filter(([_, value]) => value > 0)
                    .sort(([_, a], [__, b]) => b - a)
                    .forEach(([key, value]) => {
                        console.log(chalk.dim('  • ') + chalk.cyan(key.replace(/_/g, ' ')) + chalk.dim(': ') + chalk.yellow(value.toString()));
                    });
            }
        }

        if (ext.manifest?.permissions && ext.manifest.permissions.length > 0) {
            console.log('');
            console.log(chalk.bold('🔑 Permissions:'));
            ext.manifest.permissions.forEach((perm: string) => {
                console.log(chalk.dim('  • ') + chalk.magenta(perm));
            });
        }

        if (ext.manifest) {
            console.log('');
            console.log(chalk.bold('📄 Manifest Keys:'));
            Object.keys(ext.manifest)
                .filter(key => !['name', 'description', 'version', 'permissions'].includes(key))
                .forEach((key) => {
                    console.log(chalk.dim('  • ') + chalk.gray(key));
                });
        }

        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        console.log('');
        console.log(chalk.bold('📂 File Paths:'));
        if (mv2Path) console.log(chalk.dim('  MV2: ') + chalk.blue(mv2Path));
        if (mv3Path) console.log(chalk.dim('  MV3: ') + chalk.green(mv3Path));

        console.log('');
        await this.waitForKeypress(chalk.dim('Press Enter to continue...'));
    }

    async showLogs(ext: ExtensionSearchResult): Promise<void> {
        console.log('Fetching logs from database...');

        if (!Database.shared.database) {
            console.log('❌ Database not initialized');
            await this.waitForKeypress('\nPress Enter to continue...');
            return;
        }

        let logs;
        try {
            logs = await Database.shared.database
                .collection(Collections.LOGS)
                .find({ 'extension.id': ext.id })
                .sort({ time: -1 })
                .toArray();
        } catch (error: any) {
            console.log('❌ Failed to fetch logs from database');
            console.log(`Error: ${error.message}`);
            await this.waitForKeypress('\nPress Enter to continue...');
            return;
        }

        if (logs.length === 0) {
            console.log('No logs found for this extension');
            await this.waitForKeypress('\nPress Enter to continue...');
            return;
        }

        // Format logs to text
        const logLines: string[] = [];
        logLines.push(`Logs for ${ext.name || 'Unknown Extension'}`);
        logLines.push(`Extension ID: ${ext.id}`);
        logLines.push(`Total logs: ${logs.length}`);
        logLines.push('═'.repeat(80));
        logLines.push('');

        logs.forEach((log) => {
            try {
                const level = log.loglevel?.toUpperCase().padEnd(7) || 'UNKNOWN';
                const time = log.time ? new Date(log.time).toLocaleString() : 'N/A';
                const message = log.message || 'No message';
                logLines.push(`[${time}] ${level} ${message}`);

                if (log.meta) {
                    if (log.meta.error) {
                        const errorStr = typeof log.meta.error === 'string'
                            ? log.meta.error
                            : JSON.stringify(log.meta.error, null, 2);
                        logLines.push(`  Error: ${errorStr}`);
                    }

                    // Show other metadata if present
                    const otherMeta = { ...log.meta };
                    delete otherMeta.error;
                    if (Object.keys(otherMeta).length > 0) {
                        logLines.push(`  Metadata: ${JSON.stringify(otherMeta, null, 2)}`);
                    }
                }
                logLines.push('');
            } catch (error: any) {
                logLines.push(`[ERROR] Failed to format log entry: ${error.message}`);
                logLines.push(`Raw log: ${JSON.stringify(log, null, 2)}`);
                logLines.push('');
            }
        });

        // Write to temp file and open in less
        const tmpDir = require('os').tmpdir();
        const tmpFile = path.join(tmpDir, `ext-logs-${ext.id}-${Date.now()}.txt`);

        try {
            fs.writeFileSync(tmpFile, logLines.join('\n'));
        } catch (error: any) {
            console.log('❌ Failed to write logs to temp file');
            console.log(`Error: ${error.message}`);
            await this.waitForKeypress('\nPress Enter to continue...');
            return;
        }

        try {
            execSync(`less -R "${tmpFile}"`, { stdio: 'inherit' });
        } catch (error: any) {
            // Check if it's an actual error or just less exiting normally
            if (error.status !== 0 && error.code === 'ENOENT') {
                console.log('❌ less command not found');
                console.log('Falling back to cat...');
                try {
                    execSync(`cat "${tmpFile}"`, { stdio: 'inherit' });
                    await this.waitForKeypress('\nPress Enter to continue...');
                } catch (catError: any) {
                    console.log('❌ Failed to display logs');
                    console.log(`Error: ${catError.message}`);
                    await this.waitForKeypress('\nPress Enter to continue...');
                }
            }
            // Otherwise, user just exited less normally
        } finally {
            // Clean up temp file
            try {
                if (fs.existsSync(tmpFile)) {
                    fs.unlinkSync(tmpFile);
                }
            } catch (e) {
                // Ignore cleanup errors silently
            }
        }
    }

    async grepSource(ext: ExtensionSearchResult): Promise<void> {
        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        if (!mv2Path && !mv3Path) {
            console.log('❌ No extension files found');
            return;
        }

        const patternAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'pattern',
                message: 'Enter search pattern (regex):',
            },
        ]);

        const pattern = patternAnswer.pattern.trim();

        if (!pattern) {
            console.log('No pattern provided');
            return;
        }

        const choices = [];
        if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
        if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });
        choices.push({ name: 'Both', value: 'b' });

        const versionAnswer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Search in:',
                choices,
            },
        ]);

        const choice = versionAnswer.choice;

        const searchPaths: string[] = [];
        if (choice === '2' && mv2Path) {
            searchPaths.push(mv2Path);
        } else if (choice === '3' && mv3Path) {
            searchPaths.push(mv3Path);
        } else if (choice === 'b') {
            if (mv2Path) searchPaths.push(mv2Path);
            if (mv3Path) searchPaths.push(mv3Path);
        }

        if (searchPaths.length === 0) {
            console.log('❌ No valid paths to search');
            return;
        }

        try {
            for (const searchPath of searchPaths) {
                const versionLabel = searchPath === mv2Path ? 'MV2' : 'MV3';
                console.log(`\n${'═'.repeat(70)}`);
                console.log(`Results in ${versionLabel} (${searchPath}):`);
                console.log('═'.repeat(70));

                const result = execSync(`rg -n "${pattern}" "${searchPath}" || true`, {
                    encoding: 'utf8',
                    maxBuffer: 10 * 1024 * 1024,
                });

                if (result.trim()) {
                    console.log(result);
                } else {
                    console.log('No matches found');
                }
            }
        } catch (error: any) {
            console.log('❌ Error running grep:', error.message);
        }

        await this.waitForKeypress('\nPress Enter to continue...');
    }

    async viewManifest(ext: ExtensionSearchResult): Promise<void> {
        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        const choices = [];
        if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
        if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Which version?',
                choices,
            },
        ]);

        const choice = answer.choice;

        let manifestPath: string | null = null;

        if (choice === '2' && mv2Path) {
            manifestPath = path.join(mv2Path, 'manifest.json');
        } else if (choice === '3' && mv3Path) {
            manifestPath = path.join(mv3Path, 'manifest.json');
        } else {
            console.log('❌ Invalid choice or version not available');
            return;
        }

        if (!fs.existsSync(manifestPath)) {
            console.log(`❌ Manifest not found at: ${manifestPath}`);
            return;
        }

        try {
            // Try to use bat for syntax highlighting, fall back to cat
            try {
                execSync(`bat --style=numbers,grid "${manifestPath}"`, { stdio: 'inherit' });
            } catch {
                const content = fs.readFileSync(manifestPath, 'utf8');
                console.log('\n' + content);
            }
        } catch (error: any) {
            console.log('❌ Error reading manifest:', error.message);
        }

        await this.waitForKeypress('\nPress Enter to continue...');
    }

    async openDirectory(ext: ExtensionSearchResult): Promise<void> {
        const mv2Path = this.getMv2Path(ext);
        const mv3Path = this.getMv3Path(ext);

        const choices = [];
        if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
        if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });

        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Which version?',
                choices,
            },
        ]);

        const choice = answer.choice;

        let pathToOpen: string | null = null;

        if (choice === '2' && mv2Path) {
            pathToOpen = mv2Path;
        } else if (choice === '3' && mv3Path) {
            pathToOpen = mv3Path;
        } else {
            console.log('❌ Invalid choice or version not available');
            return;
        }

        try {
            console.log(`📂 Opening: ${pathToOpen}`);
            execSync(`open "${pathToOpen}"`, { stdio: 'inherit' });
        } catch (error: any) {
            console.log('❌ Error opening directory:', error.message);
            console.log(`Path: ${pathToOpen}`);
        }
    }

    private getMv2Path(ext: ExtensionSearchResult): string | null {
        if (!ext.manifest_v2_path) return null;

        const mv2Path = ext.manifest_v2_path.endsWith('manifest.json')
            ? path.dirname(ext.manifest_v2_path)
            : ext.manifest_v2_path;

        return fs.existsSync(mv2Path) ? mv2Path : null;
    }

    private getMv3Path(ext: ExtensionSearchResult): string | null {
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

    private async execCommand(command: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, { stdio: 'pipe' });
            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Command exited with code ${code}`));
            });
            proc.on('error', reject);
        });
    }

    private async waitForKeypress(message: string): Promise<void> {
        await inquirer.prompt([
            {
                type: 'input',
                name: 'continue',
                message,
            },
        ]);
    }

    async runActionLoop(ext: ExtensionSearchResult): Promise<boolean> {
        while (true) {
            const action = await this.showActionsMenu(ext);

            switch (action) {
                case 'v':
                    await this.viewSource(ext);
                    break;
                case 'c':
                    await this.compareExtensions(ext);
                    break;
                case 'r':
                    await this.runExtension(ext);
                    break;
                case 'i':
                    await this.showInfo(ext);
                    break;
                case 'l':
                    await this.showLogs(ext);
                    break;
                case 'g':
                    await this.grepSource(ext);
                    break;
                case 'm':
                    await this.viewManifest(ext);
                    break;
                case 'o':
                    await this.openDirectory(ext);
                    break;
                case 's':
                    return true; // Signal to search again
                case 'q':
                    return false; // Signal to quit
                default:
                    console.log('❌ Invalid action');
                    await this.waitForKeypress('Press Enter to continue...');
            }
        }
    }

    close(): void {
        // No cleanup needed for inquirer
    }
}

async function main() {
    const args = process.argv.slice(2);
    const options: SearchOptions = {};
    let directExtensionId: string | null = null;
    let directAction: string | null = null;

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === '--min-score' && i + 1 < args.length) {
            options.minScore = parseInt(args[++i]);
        } else if (arg === '--has-mv3') {
            options.hasMv3 = true;
        } else if (arg === '--no-mv3') {
            options.noMv3 = true;
        } else if (arg === '--permission' && i + 1 < args.length) {
            options.permission = args[++i];
        } else if (arg === '--pattern' && i + 1 < args.length) {
            options.pattern = args[++i];
        } else if (arg === '--name' && i + 1 < args.length) {
            options.nameFilter = args[++i];
        } else if (arg === '--view' || arg === '--compare' || arg === '--run') {
            directAction = arg.substring(2); // Remove '--'
        } else if (!arg.startsWith('--')) {
            directExtensionId = arg;
        }
    }

    if (!process.env.OUTPUT_DIR || !process.env.INPUT_DIR) {
        console.error('❌ OUTPUT_DIR and INPUT_DIR must be set in .env');
        exit(1);
    }

    const explorer = new ExtensionExplorer();

    // Handle SIGINT (Ctrl+C) gracefully
    let sigintCount = 0;
    process.on('SIGINT', async () => {
        sigintCount++;
        if (sigintCount === 1) {
            console.log('\n\n👋 Interrupted. Press Ctrl+C again to force quit.');
            try {
                explorer.close();
                await Database.shared.close();
            } catch (e) {
                // Ignore cleanup errors
            }
            exit(0);
        } else {
            console.log('\n\nForce quitting...');
            process.exit(1);
        }
    });

    try {
        await Database.shared.init();

        if (directExtensionId) {
            // Direct access to extension
            const extensions = await explorer.getAllExtensions();
            let ext = extensions.find(e => e.id === directExtensionId);

            if (!ext) {
                ext = extensions.find(e => e.mv3_extension_id === directExtensionId);
            }

            if (!ext) {
                console.log(`❌ Extension with ID ${directExtensionId} not found`);
                exit(1);
            }

            if (directAction === 'view') {
                await explorer.viewSource(ext);
            } else if (directAction === 'compare') {
                await explorer.compareExtensions(ext);
            } else if (directAction === 'run') {
                await explorer.runExtension(ext);
            } else {
                const shouldContinue = await explorer.runActionLoop(ext);
                if (!shouldContinue) {
                    exit(0);
                }
            }
        } else {
            // Interactive search mode
            while (true) {
                console.log(chalk.blue('🔍 Loading extensions...'));
                const extensions = await explorer.getAllExtensions(options);

                if (extensions.length === 0) {
                    console.log('❌ No extensions found matching criteria');
                    break;
                }

                console.log(chalk.dim(`Found ${extensions.length} extensions`));

                const selected = await explorer.searchWithInquirer(extensions);

                if (!selected) {
                    console.log(chalk.cyan('\n👋 Goodbye!'));
                    break;
                }

                const shouldContinue = await explorer.runActionLoop(selected);
                if (!shouldContinue) {
                    console.log(chalk.cyan('\n👋 Goodbye!'));
                    break;
                }
            }
        }
    } catch (error) {
        console.error(chalk.red('❌ Error:'), error);
        exit(1);
    } finally {
        explorer.close();
        await Database.shared.close();
    }
}

// Run the script
if (require.main === module) {
    main().catch(console.error);
}
