import * as readline from 'readline';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ExtensionSearchResult, MenuItem } from './types';
import * as terminalKit from 'terminal-kit';

const term = terminalKit.terminal;

export async function getKeypress(): Promise<any> {
    return new Promise((resolve) => {
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }

        const onKeypress = (str: string, key: any) => {
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.removeListener('keypress', onKeypress);
            process.stdin.pause();
            resolve(key);
        };

        process.stdin.on('keypress', onKeypress);
        process.stdin.resume();
    });
}

export async function waitForKeypress(message: string): Promise<void> {
    try {
        await inquirer.prompt([
            {
                type: 'input',
                name: 'continue',
                message,
            },
        ]);
    } catch (error) {
        console.log(error as any);
        // User pressed ESC or Ctrl+C - just return
    }
}

export async function showActionsMenu(ext: ExtensionSearchResult): Promise<string> {
    console.clear();
    // Clear all Kitty graphics images
    term('\x1b_Ga=d\x1b\\');
    console.log('');
    console.log(chalk.bold.cyan(`  ${ext.name || 'Unknown Extension'}`));
    console.log(
        chalk.dim(
            `  ${ext.id}${ext.mv3_extension_id ? chalk.green(' → ' + ext.mv3_extension_id) : ''}`
        )
    );
    console.log('');

    const menuItems: MenuItem[] = [
        { icon: chalk.blue(' '), label: 'View Source', key: 'v' },
        { icon: chalk.magenta(' '), label: 'Compare Versions', key: 'c' },
        { icon: chalk.green(' '), label: 'Run Extension', key: 'r' },
        { icon: chalk.cyan(' '), label: 'Info', key: 'i' },
        { icon: chalk.black(' '), label: 'Logs', key: 'l' },
        { icon: chalk.white(' '), label: 'Grep', key: 'g' },
        { icon: chalk.yellow(' '), label: 'Manifest', key: 'm' },
        { icon: chalk.blue(' '), label: 'Open Directory', key: 'o' },
        { icon: chalk.magenta('󰚩 '), label: 'Generate Description', key: 'd' },
        { icon: chalk.dim('󰌑 '), label: 'Search Again', key: 's' },
        { icon: chalk.red('󰈆 '), label: 'Quit', key: 'q' },
    ];

    // Display menu
    menuItems.forEach((item) => {
        console.log(`${item.icon} ${item.label.padEnd(20)} ${chalk.dim('[' + item.key + ']')}`);
    });

    console.log('');
    console.log(chalk.dim('Press a key or ESC to go back'));

    // Listen for keypress
    return new Promise<string>((resolve) => {
        readline.emitKeypressEvents(process.stdin);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode(true);
        }

        const onKeypress = (str: string, key: any) => {
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(false);
            }
            process.stdin.removeListener('keypress', onKeypress);
            process.stdin.pause();

            if (key) {
                // Handle ESC
                if (key.name === 'escape') {
                    resolve('s');
                    return;
                }

                // Handle Ctrl+C
                if (key.ctrl && key.name === 'c') {
                    resolve('s');
                    return;
                }

                // Check if pressed key matches a menu item
                const item = menuItems.find((item) => item.key === key.name);
                if (item) {
                    resolve(item.key);
                    return;
                }
            }

            // Invalid key, show menu again
            resolve(showActionsMenu(ext));
        };

        process.stdin.on('keypress', onKeypress);
        process.stdin.resume();
    });
}
