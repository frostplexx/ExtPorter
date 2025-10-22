import chalk from 'chalk';
import stringWidth from 'string-width';
import { ExtensionSearchResult } from './types';

export function truncateAndPad(str: string, maxLength: number): string {
    const cleanStr = str.replace(/\x1b\[[0-9;]*m/g, '');
    const width = stringWidth(cleanStr);

    if (width <= maxLength) {
        const padding = ' '.repeat(maxLength - width);
        return str + padding;
    }

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

export function formatExtensionForDisplay(ext: ExtensionSearchResult): string {
    const rawName = ext.name || ext.manifest?.name || 'Unknown';
    const name = truncateAndPad(rawName, 35);

    const score = String(ext.interestingness_score || 0).padStart(4);

    const rawDesc = ext.manifest?.description || '';
    const description = truncateAndPad(rawDesc, 60);

    const mv3Status = ext.mv3_extension_id ? chalk.green('✓') : chalk.red('✗');
    const id = truncateAndPad(ext.id, 32);

    return `${chalk.cyan(name)}  ${chalk.yellow(score)}  ${mv3Status}  ${chalk.dim(description)}  ${chalk.gray(id)}`;
}

export function displayExtensionList(
    searchQuery: string,
    filteredExtensions: ExtensionSearchResult[],
    totalCount: number,
    selectedIndex: number
): void {
    console.clear();
    console.log(chalk.cyan('Search Extensions'));
    console.log(
        chalk.dim(
            `Filter: ${searchQuery || '(none)'} | ${filteredExtensions.length} of ${totalCount} extensions | arrows to navigate, ESC to quit`
        )
    );
    console.log('');

    const displayStart = Math.max(0, selectedIndex - 10);
    const displayEnd = Math.min(filteredExtensions.length, displayStart + 20);

    for (let i = displayStart; i < displayEnd; i++) {
        const ext = filteredExtensions[i];
        const formatted = formatExtensionForDisplay(ext);
        if (i === selectedIndex) {
            console.log(chalk.inverse(` ${formatted} `));
        } else {
            console.log(`  ${formatted}  `);
        }
    }
}

export function filterExtensions(
    extensions: ExtensionSearchResult[],
    query: string
): ExtensionSearchResult[] {
    if (!query) return extensions;

    const lowerQuery = query.toLowerCase();
    return extensions.filter((ext) => {
        const name = (ext.name || ext.manifest?.name || '').toLowerCase();
        const desc = (ext.manifest?.description || '').toLowerCase();
        const id = ext.id.toLowerCase();
        return name.includes(lowerQuery) || desc.includes(lowerQuery) || id.includes(lowerQuery);
    });
}
