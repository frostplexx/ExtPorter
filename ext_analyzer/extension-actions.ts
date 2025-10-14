import * as fs from 'fs';
import * as path from 'path';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { Database, Collections } from '../migrator/features/database/db_manager';
import { Extension } from '../migrator/types/extension';
import { ChromeTester } from '../ext_tester/chrome_tester';
import { ExtensionSearchResult } from './types';
import { getMv2Path, getMv3Path, execCommand, collectExtensionFiles } from './file-operations';
import { llmManager } from './llm-manager';
import { waitForKeypress } from './input-handler';

export async function viewSource(ext: ExtensionSearchResult): Promise<void> {
    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    if (!mv2Path && !mv3Path) {
        console.log('❌ No extension files found');
        return;
    }

    try {
        if (mv2Path && mv3Path) {
            console.log(`Opening Kitty with MV2 (left) and MV3 (right)...`);

            // Create new tab with MV2
            await execCommand(
                'kitten',
                [
                    '@', 'launch', '--type=tab',
                    '--tab-title', `${ext.name} (MV2 ↔ MV3)`,
                    '--cwd', mv2Path,
                    '--title', `MV2: ${ext.id}`,
                ]
            );

            // Add MV3 split
            await execCommand(
                'kitten',
                [
                    '@', 'launch', '--location', 'vsplit',
                    '--cwd', mv3Path,
                    '--title', `MV3: ${ext.mv3_extension_id}`,
                ]
            );
        } else if (mv2Path) {
            console.log(`Opening Kitty with MV2 only...`);
            await execCommand(
                'kitten',
                ['@', 'launch', '--type=tab', '--cwd', mv2Path, '--title', `MV2: ${ext.id}`]
            );
        } else if (mv3Path) {
            console.log(`Opening Kitty with MV3 only...`);
            await execCommand(
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

export async function compareExtensions(ext: ExtensionSearchResult): Promise<void> {
    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

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

    try {
        await Promise.all([
            (async () => {
                console.log('Starting MV3 browser (red)...');
                await mv3Tester.initBrowser(mv3Extension, 3, false, true);
                mv3Tester.navigateTo('https://www.nytimes.com/');
            })(),
            (async () => {
                console.log('Starting MV2 browser (blue)...');
                await mv2Tester.initBrowser(mv2Extension, 3, true, true);
                mv2Tester.navigateTo('https://www.nytimes.com/');
            })(),
        ]);
    } catch (error) {
        console.log(error as any)
    }
    console.log('✓ Both browsers launched successfully');
    console.log('  Close the browsers when done...');
}

export async function runExtension(ext: ExtensionSearchResult): Promise<void> {
    let is_mv_2: boolean = true;
    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    const choices = [];
    if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
    if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });
    choices.push({ name: 'Back to menu', value: 'b' });

    let choice;
    try {
        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Which version would you like to run?',
                choices,
            },
        ]);
        choice = answer.choice;
    } catch (error) {
        console.log(error as any)
        // User pressed ESC or Ctrl+C
        return;
    }

    let pathToRun: string | null = null;

    if (choice === '2' && mv2Path) {
        pathToRun = mv2Path;
        is_mv_2 = true;
    } else if (choice === '3' && mv3Path) {
        pathToRun = mv3Path;
        is_mv_2 = false;
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

        const browser = new ChromeTester()
        const tmpExt: Extension = {
            id: "00000",
            name: "tmp",
            manifest_v2_path: pathToRun,
            manifest: {},
            files: []
        }

        await Promise.all([
            (async () => {
                console.log('Starting MV3 browser (red)...');
                await browser.initBrowser(tmpExt, 3, is_mv_2, true);
                await browser.navigateTo('https://www.nytimes.com/');
            })(),
        ]);

        console.log('✓ Both browsers launched successfully');
        console.log('  Close the browsers when done...');
    } catch (error: any) {
        console.log('❌ Error launching Chrome:', error.message);
    }
}

export async function showInfo(ext: ExtensionSearchResult): Promise<void> {
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

    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    console.log('');
    console.log(chalk.bold('📂 File Paths:'));
    if (mv2Path) console.log(chalk.dim('  MV2: ') + chalk.blue(mv2Path));
    if (mv3Path) console.log(chalk.dim('  MV3: ') + chalk.green(mv3Path));

    console.log('');
    await waitForKeypress(chalk.dim('Press Enter to continue...'));
}

export async function showLogs(ext: ExtensionSearchResult): Promise<void> {
    console.log('Fetching logs from database...');

    if (!Database.shared.database) {
        console.log('❌ Database not initialized');
        await waitForKeypress('\nPress Enter to continue...');
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
        await waitForKeypress('\nPress Enter to continue...');
        return;
    }

    if (logs.length === 0) {
        console.log('No logs found for this extension');
        await waitForKeypress('\nPress Enter to continue...');
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
        await waitForKeypress('\nPress Enter to continue...');
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
                await waitForKeypress('\nPress Enter to continue...');
            } catch (catError: any) {
                console.log('❌ Failed to display logs');
                console.log(`Error: ${catError.message}`);
                await waitForKeypress('\nPress Enter to continue...');
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

export async function grepSource(ext: ExtensionSearchResult): Promise<void> {
    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    if (!mv2Path && !mv3Path) {
        console.log('❌ No extension files found');
        return;
    }

    let patternAnswer;
    try {
        patternAnswer = await inquirer.prompt([
            {
                type: 'input',
                name: 'pattern',
                message: 'Enter search pattern (regex):',
            },
        ]);
    } catch (error) {
        // User pressed ESC or Ctrl+C
        return;
    }

    const pattern = patternAnswer.pattern.trim();

    if (!pattern) {
        console.log('No pattern provided');
        return;
    }

    const choices = [];
    if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
    if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });
    choices.push({ name: 'Both', value: 'b' });

    let versionAnswer;
    try {
        versionAnswer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Search in:',
                choices,
            },
        ]);
    } catch (error) {
        // User pressed ESC or Ctrl+C
        return;
    }

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

    await waitForKeypress('\nPress Enter to continue...');
}

export async function viewManifest(ext: ExtensionSearchResult): Promise<void> {
    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    const choices = [];
    if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
    if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });

    let choice;
    try {
        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Which version?',
                choices,
            },
        ]);
        choice = answer.choice;
    } catch (error) {
        // User pressed ESC or Ctrl+C
        return;
    }

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

    await waitForKeypress('\nPress Enter to continue...');
}

export async function openDirectory(ext: ExtensionSearchResult): Promise<void> {
    const mv2Path = getMv2Path(ext);
    const mv3Path = getMv3Path(ext);

    const choices = [];
    if (mv2Path) choices.push({ name: 'MV2 version', value: '2' });
    if (mv3Path) choices.push({ name: 'MV3 version', value: '3' });

    let choice;
    try {
        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Which version?',
                choices,
            },
        ]);
        choice = answer.choice;
    } catch (error) {
        // User pressed ESC or Ctrl+C
        return;
    }

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

export async function generateDescription(ext: ExtensionSearchResult): Promise<void> {
    console.clear();

    // Get LLM configuration from environment
    const llmEndpoint = process.env.LLM_ENDPOINT || 'http://localhost:11434';
    const llmModel = process.env.LLM_MODEL || 'llama3.2';

    try {
        const codeFiles: { path: string; content: string }[] = [];

        // Collect extension files
        const mv2Path = getMv2Path(ext);
        if (mv2Path) {
            codeFiles.push(...collectExtensionFiles(mv2Path));
        }

        console.log(chalk.dim(`Collected ${codeFiles.length} files`));

        // Build description focused on the extension itself
        const manifestFile = codeFiles.find(f => f.path.includes('manifest.json'));
        const manifest = manifestFile ? JSON.parse(manifestFile.content) : null;

        // Get extension code files
        const extensionFiles = codeFiles
            .filter(f => f.path.includes('extension/'))
            .map(f => {
                return `${f.path}:\n${f.content}`;
            })
            .join('\n\n---\n\n');

        const manifestSummary = `Manifest.json: ${JSON.stringify(manifest)}`

        const prompt = `You are a helpful assistant which analyzes Chrome browser extensions and generates concise documentation. Given an extension's manifest and source code, you identify the extension's core functionality and generate clear testing instructions.

Extension Name: ${ext.name || 'Unknown'}
${manifestSummary}

Source Files:
${extensionFiles}

Please analyze the extension above and generate documentation following these guidelines:

Output Requirements:
- Write a concise description (1-2 sentences) explaining what the extension does
- Provide 4-5 specific test steps that verify the extension's functionality
- Keep your total response under 200 words
- Be specific about URLs, UI elements, and user actions
- Use clear, direct language
- Asume that the extension is already installed and that the user wants to tests its functionality
- Focus on the manifest file, only ouput if you are sure that it does, do not assume

Output Format:
## What it does
[2-3 sentences describing the extension's purpose and main features]

## Test steps
1. [First action the user should take, with specific details]
2. [Second action or observation]
3. [Third action or observation]
4. [Fourth action or observation]
5. [Expected result or final verification]

Guidelines you must obey:
- Do not hallucinate. Do not make up factual information
- Base your description only on the provided code and manifest
- If the code is unclear or minified, focus on the manifest permissions and API usage
- Keep each sentence under 15 words for clarity
- Mention specific websites or pages where relevant
- Do not include meta-commentary, disclaimers, or explanations about these guidelines
- Only output the formatted documentation, nothing else`;

        // Get persistent LLM service (reuses SSH tunnel if already open)
        const llmService = await llmManager.getService();

        // Show prompt stats
        const tmpDir = require('os').tmpdir();
        const tmpFile = path.join(tmpDir, `ext-description-${ext.id}-${Date.now()}.md`);
        const promptTokens = Math.ceil(prompt.length / 4);
        const promptSizeKB = Math.ceil(prompt.length / 1024);

        console.log(chalk.dim(`Sending to LLM (${llmEndpoint})...`));
        console.log(chalk.dim(`Model: ${llmModel} | Tokens: ~${promptTokens} (~${promptSizeKB}KB)`));
        console.log(chalk.yellow('⏳ Generating description...'));
        console.log('');

        // Call LLM API
        const response = await llmService.generateCompletion(prompt);

        const output =
            `Extension: ${ext.name || 'Unknown'}\n` +
            `ID: ${ext.id}\n\n` +
            `---\n\n` +
            prompt +
            `---\n\n` +
            response;

        fs.writeFileSync(tmpFile, output);

        // Wait for user before continuing
        console.log('');
        await waitForKeypress(chalk.dim('Press Enter to continue...'));
        // Clean up temp file
        try {
            if (fs.existsSync(tmpFile)) {
                fs.unlinkSync(tmpFile);
            }
        } catch (e) {
            // Ignore cleanup errors silently
        }
    } catch (error: any) {
        console.log('');
        console.log(chalk.red('❌ Error generating description:'), error.message);
        await waitForKeypress('\nPress Enter to continue...');
    }
}
